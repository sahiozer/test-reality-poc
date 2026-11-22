"""Shared measurement semantics, constrained graph planning and PostgreSQL rendering.

Only trusted feature definitions map to physical relations. Predicates are data,
never SQL or display text. Row templates are immutable and rendered with bindings.
"""
from collections import Counter
from dataclasses import dataclass, asdict
import hashlib
import json


class RepairError(ValueError):
    pass


SCHEMAS = {'CUSTOMER_LENDING': ('prod_snapshot', 'test_env'), 'CARDS': ('prod_cards', 'test_cards')}
# Canonical feature -> type / physical relationship. The SQL projections below are
# also used by the measurement engine, including its boolean/bucket adapters.
FEATURES = {
 'CUSTOMER_LENDING': {
  'customer_type': ('enum', ('RETAIL','CORPORATE'), 'customer.customer_type'),
  'customer_status': ('enum', ('OPEN','CLOSED'), 'customer.status'),
  'active_account_count': ('count', None, 'customer -> account[status=ACTIVE]'),
  'fx_account_count': ('count', None, 'customer -> account[currency<>TRY], all statuses'),
  'blocked_account_count': ('count', None, 'customer -> account[blocked_flag], all statuses'),
  'active_loan_count': ('count', None, 'customer -> loan[status=ACTIVE]'),
  'active_card_count': ('count', None, 'customer -> card[status=ACTIVE]')},
 'CARDS': {
  'card_type': ('enum', ('CREDIT','DEBIT'), 'card.card_type'),
  'physical_virtual': ('enum', ('PHYSICAL','VIRTUAL'), 'card.physical_virtual'),
  'card_status': ('enum', ('ACTIVE','CLOSED','BLOCKED'), 'card.status'),
  'active_card_count': ('count', None, 'card.customer_id -> sibling card[status=ACTIVE]'),
  'has_available_limit': ('bool', None, 'card -> card_limit.available_limit>0'),
  'high_limit_bucket': ('enum', ('HIGH','STANDARD'), 'card -> card_limit.total_limit>=50000'),
  'has_recent_status_change': ('bool', None, 'card -> MAX(history.changed_at), within 7 days of TEST MAX'),
  'has_physical_and_virtual': ('bool', None, 'owner -> COUNT(DISTINCT card.physical_virtual)>1')}
}
STATE_FEATURES = {
 'CUSTOMER_LENDING': ['customer_type','account_count_bucket','has_fx_account','has_active_loan','has_active_card','has_blocked_account'],
 'CARDS': ['card_type','physical_virtual','card_status','active_card_count_bucket','has_available_limit','high_limit_bucket','has_recent_status_change','has_physical_and_virtual']}


def projection(domain, schema):
    if domain not in SCHEMAS or schema not in SCHEMAS[domain]: raise RepairError('Unknown measurement schema')
    if domain == 'CUSTOMER_LENDING':
        return f"""WITH a AS (SELECT customer_id,
          COUNT(*) FILTER(WHERE status='ACTIVE') AS active_account_count,
          COUNT(*) FILTER(WHERE currency<>'TRY') AS fx_account_count,
          COUNT(*) FILTER(WHERE blocked_flag) AS blocked_account_count FROM {schema}.account GROUP BY customer_id),
        l AS (SELECT customer_id,COUNT(*) FILTER(WHERE status='ACTIVE') AS active_loan_count FROM {schema}.loan GROUP BY customer_id),
        k AS (SELECT customer_id,COUNT(*) FILTER(WHERE status='ACTIVE') AS active_card_count FROM {schema}.card GROUP BY customer_id)
        SELECT c.customer_id AS entity_id,c.customer_type,c.status AS customer_status,
          COALESCE(a.active_account_count,0) AS active_account_count,
          COALESCE(a.fx_account_count,0) AS fx_account_count,
          COALESCE(a.blocked_account_count,0) AS blocked_account_count,
          COALESCE(l.active_loan_count,0) AS active_loan_count,
          COALESCE(k.active_card_count,0) AS active_card_count
        FROM {schema}.customer c LEFT JOIN a USING(customer_id) LEFT JOIN l USING(customer_id) LEFT JOIN k USING(customer_id)"""
    return f"""WITH entities AS (SELECT customer_id,COUNT(*) FILTER(WHERE status='ACTIVE') AS active_card_count,
        COUNT(DISTINCT physical_virtual)>1 AS mixed FROM {schema}.card GROUP BY customer_id),
      history AS (SELECT card_id,MAX(changed_at) AS latest FROM {schema}.card_status_history GROUP BY card_id),
      cutoff AS (SELECT MAX(changed_at) AS latest FROM {schema}.card_status_history)
      SELECT c.card_id AS entity_id,c.customer_id,c.card_type,c.physical_virtual,c.status AS card_status,
        e.active_card_count,COALESCE(l.available_limit>0,false) AS has_available_limit,
        CASE WHEN l.total_limit>=50000 THEN 'HIGH' ELSE 'STANDARD' END AS high_limit_bucket,
        COALESCE(h.latest>=cutoff.latest-INTERVAL '7 days',false) AS has_recent_status_change,
        e.mixed AS has_physical_and_virtual
      FROM {schema}.card c JOIN entities e USING(customer_id) LEFT JOIN {schema}.card_limit l USING(card_id)
      LEFT JOIN history h USING(card_id) CROSS JOIN cutoff"""


def measurement_query(domain, schema):
    fields = STATE_FEATURES[domain]
    if domain == 'CUSTOMER_LENDING':
        expressions = ['customer_type','customer_status',"CASE WHEN active_account_count=0 THEN '0' WHEN active_account_count=1 THEN '1' ELSE '2+' END AS account_count_bucket",
            'fx_account_count>0 AS has_fx_account','active_loan_count>0 AS has_active_loan',
            'active_card_count>0 AS has_active_card','blocked_account_count>0 AS has_blocked_account']
    else:
        expressions = ["CASE WHEN active_card_count=0 THEN '0' WHEN active_card_count=1 THEN '1' ELSE '2+' END AS active_card_count_bucket" if f=='active_card_count_bucket' else f for f in fields]
    return 'SELECT '+','.join(expressions)+',COUNT(*) AS count FROM ('+projection(domain,schema)+') canonical GROUP BY '+','.join(str(i+1) for i in range(len(expressions)))


def condition(feature, operator, value):
    return {'feature':feature,'operator':operator,'value':value}


def predicate(domain, conditions, unit=None):
    if domain not in SCHEMAS: raise RepairError('Unknown repair domain')
    return {'entity':'CUSTOMER' if domain=='CUSTOMER_LENDING' or unit=='QUALIFYING_CUSTOMER' else 'CARD',
        'unit':unit or ('QUALIFYING_CUSTOMER' if domain=='CUSTOMER_LENDING' else 'QUALIFYING_CARD'),
        'conditions':conditions,'relationships':{k:v[2] for k,v in FEATURES[domain].items() if any(c['feature']==k for c in conditions)}}


def state_predicate(domain, state):
    conditions=[]
    for feature,value in state.items():
        if feature in ('account_count_bucket','active_card_count_bucket'):
            canonical='active_account_count' if feature=='account_count_bucket' else 'active_card_count'
            if value not in ('0','1','2+'): raise RepairError('Unsupported count bucket')
            conditions.append(condition(canonical,'GTE' if value=='2+' else 'EQ',2 if value=='2+' else int(value)))
        elif feature in {'has_fx_account','has_blocked_account','has_active_loan','has_active_card'}:
            canonical={'has_fx_account':'fx_account_count','has_blocked_account':'blocked_account_count','has_active_loan':'active_loan_count','has_active_card':'active_card_count'}[feature]
            if type(value) is not bool: raise RepairError('Invalid presence feature')
            conditions.append(condition(canonical,'GTE' if value else 'EQ',1 if value else 0))
        else: conditions.append(condition(feature,'EQ',value))
    return predicate(domain,conditions)


def named_predicate(domain):
    if domain=='CUSTOMER_LENDING':
        return predicate(domain,[condition('customer_status','EQ','OPEN'),condition('active_account_count','GTE',2),condition('blocked_account_count','GTE',1)])
    return predicate(domain,[condition('card_status','EQ','ACTIVE'),condition('card_type','EQ','CREDIT'),condition('has_available_limit','EQ',True),condition('active_card_count','GTE',2)])


def headline_predicate(domain):
    return predicate(domain,[condition('active_account_count' if domain=='CUSTOMER_LENDING' else 'active_card_count','GTE',2)],'QUALIFYING_CUSTOMER')


def constraints(domain, pred):
    if domain not in FEATURES or not isinstance(pred,dict): raise RepairError('Invalid predicate')
    expected='CUSTOMER' if domain=='CUSTOMER_LENDING' or pred.get('unit')=='QUALIFYING_CUSTOMER' else 'CARD'
    if pred.get('entity')!=expected or pred.get('unit') not in (('QUALIFYING_CUSTOMER',) if domain=='CUSTOMER_LENDING' else ('QUALIFYING_CUSTOMER','QUALIFYING_CARD')): raise RepairError('Unsupported predicate entity/unit')
    if pred.get('exclusions'): raise RepairError('Unsupported predicate exclusions')
    values={}
    for c in pred.get('conditions',[]):
        if set(c)!={'feature','operator','value'}: raise RepairError('Invalid condition fields')
        f,op,v=c['feature'],c['operator'],c['value']
        if f not in FEATURES[domain]: raise RepairError('Unsupported canonical feature: '+str(f))
        typ,allowed,_=FEATURES[domain][f]
        if typ=='count':
            if type(v) is not int or v<0 or op not in ('EQ','GTE','GT','LTE','LT'): raise RepairError('Invalid count constraint: '+f)
            lo,hi=values.get(f,(0,32))
            if op in ('EQ','GTE','GT'):lo=max(lo,v+(op=='GT'))
            if op in ('EQ','LTE','LT'):hi=min(hi,v-(op=='LT'))
            if lo>hi: raise RepairError('Unsatisfiable or exceeds 32 related rows: '+f)
            values[f]=(lo,hi)
        else:
            if op!='EQ' or (typ=='bool' and type(v) is not bool) or (typ=='enum' and v not in allowed): raise RepairError('Unsupported value/operator: '+f)
            if f in values and values[f]!=v: raise RepairError('Conflicting constraint: '+f)
            values[f]=v
    if not pred.get('conditions'): raise RepairError('Predicate must contain conditions')
    return values


def matches(pred,values):
    import operator
    ops={'EQ':operator.eq,'GTE':operator.ge,'GT':operator.gt,'LTE':operator.le,'LT':operator.lt}
    return all(ops[c['operator']](values[c['feature']],c['value']) for c in pred['conditions'])


def predicate_where(domain,pred):
    constraints(domain,pred)
    operators={'EQ':'=','GTE':'>=','GT':'>','LTE':'<=','LT':'<'}
    return ' AND '.join(c['feature']+' '+operators[c['operator']]+' %s' for c in pred['conditions']),tuple(c['value'] for c in pred['conditions'])


def count_query(domain,pred):
    where,params=predicate_where(domain,pred)
    col='DISTINCT customer_id' if domain=='CARDS' and pred['unit']=='QUALIFYING_CUSTOMER' else '*'
    return f'SELECT COUNT({col}) AS n FROM ({projection(domain,SCHEMAS[domain][1])}) canonical WHERE '+where,params


# Physical dependency order and columns are shared by every finding in a domain.
GRAPH={
 'CUSTOMER_LENDING': {
  'customer':('customer_id','customer_type','status','segment','created_at'),
  'account':('account_id','customer_id','account_type','currency','status','blocked_flag','opened_at'),
  'loan':('loan_id','customer_id','loan_type','status','outstanding_amount','delinquency_flag'),
  'card':('card_id','customer_id','card_type','status')},
 'CARDS': {
  'card_customer':('customer_id',),'funding_account':('account_id','customer_id'),
  'card':('card_id','customer_id','card_type','status','physical_virtual','created_at'),
  'card_account':('card_id','account_id','relationship_type'),
  'card_limit':('card_id','total_limit','available_limit','effective_at'),
  'card_status_history':('history_id','card_id','status','changed_at')}}


@dataclass(frozen=True)
class Row:
    table:str
    values:tuple


@dataclass(frozen=True)
class PopulationPlan:
    domain:str
    metric_key:str
    qualifying_entities_needed:int
    predicate_json:str
    rows:tuple[Row,...]
    repair_family:str='POPULATION'
    version:int=1

    def canonical(self): return asdict(self)
    def digest(self): return hashlib.sha256(json.dumps(self.canonical(),sort_keys=True).encode()).hexdigest()
    def physical_rows(self): return {k:v*self.qualifying_entities_needed for k,v in Counter(r.table for r in self.rows).items()}


def population_plan(domain,key,pred,needed):
    if type(needed) is not int or not 1<=needed<=100: raise RepairError('POC repair limit is 100 qualifying entities per operation')
    v=constraints(domain,pred)
    n=lambda f:v.get(f,(0,32))[0]
    rows=[]
    def add(table,*values): rows.append(Row(table,tuple(values)))
    if domain=='CUSTOMER_LENDING':
        if v.get('customer_status','OPEN')=='CLOSED' and n('active_account_count')>0: raise RepairError('Policy conflict: population would create CLOSED customer / ACTIVE account health violations')
        add('customer','@id:0',v.get('customer_type','RETAIL'),v.get('customer_status','OPEN'),'LOCAL_REPAIR','@timestamp')
        active,fx,blocked=n('active_account_count'),n('fx_account_count'),n('blocked_account_count')
        for i in range(max(active,fx,blocked)):
            add('account',f'@id:{i+1}','@id:0','CURRENT','USD' if i<fx else 'TRY','ACTIVE' if i<active else 'CLOSED',i<blocked,'@timestamp')
        for i in range(n('active_loan_count')):add('loan',f'@id:{100+i}','@id:0','PERSONAL','ACTIVE',1000,False)
        for i in range(n('active_card_count')):add('card',f'@id:{200+i}','@id:0','DEBIT','ACTIVE')
    else:
        owner_unit=pred['unit']=='QUALIFYING_CUSTOMER'
        if owner_unit and set(v)-{'active_card_count'}: raise RepairError('Owner-count builder only supports active_card_count; card filters require card units')
        status=v.get('card_status','ACTIVE');available=v.get('has_available_limit',False)
        if status=='CLOSED' and available: raise RepairError('Policy conflict: population would create CLOSED card / positive available limit health violations')
        active=n('active_card_count');upper=v.get('active_card_count',(0,32))[1]
        # An unconstrained active count must still include an ACTIVE anchor.
        active=max(active,int(status=='ACTIVE'))
        if active>upper: raise RepairError('Unsatisfiable card_status / active_card_count constraint')
        mixed=v.get('has_physical_and_virtual',False)
        count=max(1,active+(status!='ACTIVE'),2 if mixed else 1)
        kind=v.get('card_type','CREDIT');form=v.get('physical_virtual','PHYSICAL')
        add('card_customer','@id:0');add('funding_account','@id:0','@id:0')
        active_remaining=active-int(status=='ACTIVE')
        for i in range(count):
            anchor=i==0;ref=f'@id:{i+1}';card_status=status if anchor else ('ACTIVE' if i<=active_remaining else 'CLOSED')
            card_kind=kind if anchor else ('DEBIT' if kind=='CREDIT' else 'CREDIT')
            card_form=form if anchor or not mixed else ('VIRTUAL' if form=='PHYSICAL' else 'PHYSICAL')
            add('card',ref,'@id:0',card_kind,card_status,card_form,'@timestamp')
            add('card_account',ref,'@id:0','PRIMARY')
            add('card_limit',ref,50000 if v.get('high_limit_bucket')=='HIGH' else 30000,10000 if anchor and available else 0,'@timestamp')
            add('card_status_history',f'@id:{100+i}',ref,card_status,'@timestamp' if v.get('has_recent_status_change',True) else '@old_timestamp')
        # Check qualifying cardinality from the generated graph, including
        # support cards. Reject ambiguous partial predicates rather than overfill.
        cards=[r for r in rows if r.table=='card']
        limits={r.values[0]:r.values for r in rows if r.table=='card_limit'}
        history={r.values[1]:r.values for r in rows if r.table=='card_status_history'}
        matching=0
        for row in cards:
            ref,_,kind,status,form,_=row.values
            actual={'card_type':kind,'card_status':status,'physical_virtual':form,
                'active_card_count':sum(r.values[3]=='ACTIVE' for r in cards),
                'has_available_limit':limits[ref][2]>0,
                'high_limit_bucket':'HIGH' if limits[ref][1]>=50000 else 'STANDARD',
                'has_recent_status_change':history[ref][3]=='@timestamp',
                'has_physical_and_virtual':len({r.values[4] for r in cards})>1}
            matching+=matches(pred,actual)
        if (not owner_unit and matching!=1) or (owner_unit and matching==0):
            raise RepairError('Cannot isolate one qualifying unit from required support cards')
    order={table:i for i,table in enumerate(GRAPH[domain])}
    rows.sort(key=lambda r:order[r.table])
    return PopulationPlan(domain,key,needed,json.dumps(pred,sort_keys=True),tuple(rows))


def capability(domain,key,pred):
    try:
        population_plan(domain,key,pred,1)
        return 'POPULATION_REPAIR_AUTOMATED',None
    except RepairError as error:return 'POPULATION_REPAIR_UNSUPPORTED',str(error)


def statements(plan):
    if plan.domain not in GRAPH: raise RepairError('Forbidden repair domain')
    schema=SCHEMAS[plan.domain][1]
    result=[]
    for row in plan.rows:
        if row.table not in GRAPH[plan.domain] or len(row.values)!=len(GRAPH[plan.domain][row.table]): raise RepairError('Forbidden repair relation/columns')
        columns=','.join(GRAPH[plan.domain][row.table])
        result.append(f'INSERT INTO {schema}.{row.table} ({columns}) VALUES ('+','.join(f'%(v{i})s' for i in range(len(row.values)))+')')
    return result


def bindings(row,root,timestamp):
    from datetime import timedelta
    def resolve(value):
        if isinstance(value,str) and value.startswith('@id:'):return root-int(value[4:])
        if value=='@timestamp':return timestamp
        if value=='@old_timestamp':return timestamp-timedelta(days=8)
        return value
    return {f'v{i}':resolve(value) for i,value in enumerate(row.values)}


# Explicit POC policies choose a correction direction; predicates alone never do.
HEALTH_RULES={
 'CUSTOMER_LENDING': {'rule_key':'BR-CUSTOMER-001','metric_key':'closed_customers_with_active_accounts','label':'CLOSED customer must not have ACTIVE accounts',
  'predicate':predicate('CUSTOMER_LENDING',[condition('customer_status','EQ','CLOSED'),condition('active_account_count','GTE',1)]),
  'policy':{'key':'CLOSE_ACTIVE_ACCOUNTS_OF_CLOSED_CUSTOMER','action':'SET','table':'account','field':'status','value':'CLOSED','description':'Keep the customer CLOSED; close its ACTIVE accounts.'}},
 'CARDS': {'rule_key':'BR-CARD-001','metric_key':'closed_cards_with_available_limit','label':'CLOSED card must have zero available limit',
  'predicate':predicate('CARDS',[condition('card_status','EQ','CLOSED'),condition('has_available_limit','EQ',True)]),
  'policy':{'key':'ZERO_CLOSED_CARD_AVAILABLE_LIMIT','action':'SET','table':'card_limit','field':'available_limit','value':0,'description':'Keep the card CLOSED; set its available limit to zero.'}}
}
# Used by the Cards business metric evaluator as well as the repair policy.
CLOSED_CARD_VIOLATION = "c.status='CLOSED' AND available_limit>0"


def customer_health_group(row):
    return matches(HEALTH_RULES['CUSTOMER_LENDING']['predicate'],{'customer_status':row['customer_status'],'active_account_count':2 if row['account_count_bucket']=='2+' else int(row['account_count_bucket'])})


def health_targets(domain,rule):
    if rule!=HEALTH_RULES.get(domain) or not rule.get('policy'):raise RepairError('No approved automated correction policy')
    schema=SCHEMAS[domain][1]
    where,params=predicate_where(domain,rule['predicate'])
    entities='SELECT entity_id FROM ('+projection(domain,schema)+') canonical WHERE '+where
    if domain=='CUSTOMER_LENDING':
        return f"SELECT account_id AS id FROM {schema}.account WHERE status=%s AND customer_id IN ({entities}) ORDER BY account_id",('ACTIVE',)+params,'account_id'
    return f"SELECT card_id AS id FROM {schema}.card_limit WHERE card_id IN ({entities}) ORDER BY card_id",params,'card_id'


def health_statement(domain,rule):
    _,_,pk=health_targets(domain,rule)
    p=rule['policy']
    return f'UPDATE {SCHEMAS[domain][1]}.{p["table"]} SET {p["field"]}=%s WHERE {pk}=ANY(%s)'
