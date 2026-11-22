"""Local deterministic population and policy-driven health repairs, TEST-only."""
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from app import repair_model as model
from app.repair_model import RepairError

LOCK = 20261011  # Shared with the existing analysis coordinator.
MAX_REPAIR = 100
RECIPES = {
 'CUSTOMER_LENDING': {'metric_key':'open_customer_multi_active_blocked', 'label':'OPEN customer · 2+ ACTIVE accounts · at least one blocked account', 'unit':'qualifying customers', 'tables':{'customer':1,'account':2}},
 'CARDS': {'metric_key':'active_credit_multi_card_available', 'label':'ACTIVE CREDIT card · positive available limit · customer has 2+ ACTIVE cards', 'unit':'qualifying CREDIT cards', 'tables':{'card_customer':1,'funding_account':1,'card':2,'card_account':2,'card_limit':2,'card_status_history':2}},
}

def recipe(domain):
    if domain not in RECIPES: raise RepairError('Unknown repair domain')
    return RECIPES[domain]

def initialize():
    """Local-only additive migration. Never called when the feature flag is off."""
    cfg=conninfo_to_dict(os.environ['REPAIR_DATABASE_URL'])
    if cfg['user']!='test_reality_repair': raise RepairError('Dedicated repair role required')
    with psycopg.connect(os.environ['DATABASE_URL']) as conn:
        conn.execute(Path(__file__).with_name('local_repair.sql').read_text())
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname='test_reality_repair'").fetchone():
            conn.execute('CREATE ROLE test_reality_repair LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT')
        # Refuse an unsafe pre-existing role instead of silently using admin privileges.
        role=conn.execute("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='test_reality_repair'").fetchone()
        if any(role): raise RepairError('Repair role must be unprivileged')
        conn.execute(sql.SQL('ALTER ROLE test_reality_repair PASSWORD {}').format(sql.Literal(cfg['password'])))
        conn.execute('GRANT USAGE ON SCHEMA test_env,test_cards,metadata TO test_reality_repair')
        conn.execute('GRANT SELECT,INSERT,DELETE ON test_env.customer,test_env.account,test_env.loan,test_env.card TO test_reality_repair')
        conn.execute('GRANT SELECT,INSERT,DELETE ON test_cards.card_customer,test_cards.funding_account,test_cards.card,test_cards.card_account,test_cards.card_limit,test_cards.card_status_history TO test_reality_repair')
        conn.execute('GRANT UPDATE(status) ON test_env.account TO test_reality_repair')
        conn.execute('GRANT UPDATE(available_limit) ON test_cards.card_limit TO test_reality_repair')
        conn.execute('GRANT SELECT ON metadata.analysis_run,metadata.demo_dataset,metadata.cards_dataset TO test_reality_repair')
        conn.execute('GRANT SELECT,INSERT,UPDATE ON metadata.test_requirement,metadata.test_revision,metadata.test_repair TO test_reality_repair')
        conn.execute('GRANT SELECT,INSERT,DELETE ON metadata.test_repair_entity TO test_reality_repair')
        conn.execute('GRANT USAGE ON SEQUENCE metadata.test_repair_id TO test_reality_repair')
        if conn.execute("SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='test_reality_repair'").fetchone():
            raise RepairError('Repair role must not inherit other roles')
        # Resolve reference names as admin, without giving the writer schema access.
        tables=conn.execute("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('prod_snapshot','prod_cards') AND c.relkind IN ('r','p')").fetchall()
        for (oid,) in tables:
            for privilege in ['INSERT','UPDATE','DELETE','TRUNCATE']:
                if conn.execute("SELECT has_table_privilege('test_reality_repair',%s::oid,%s)",(oid,privilege)).fetchone()[0]:
                    raise RepairError('Repair role has forbidden PROD privileges')

def connection():
    conn=psycopg.connect(os.environ['REPAIR_DATABASE_URL'],row_factory=dict_row)
    if conn.info.user!='test_reality_repair':
        conn.close();raise RepairError('Dedicated repair role required')
    return conn

def measured(groups,domain):
    """Reuse existing grouped features, without adding/changing headline fingerprints."""
    if domain=='CUSTOMER_LENDING':
        return sum(r['count'] for r in groups if r['customer_status']=='OPEN' and r['account_count_bucket']=='2+' and r['has_blocked_account'])
    recipe(domain)
    return sum(r['count'] for r in groups if r['card_status']=='ACTIVE' and r['card_type']=='CREDIT' and r['has_available_limit'] and r['active_card_count_bucket']=='2+')

def attach(snapshot,groups,domain,conn):
    if os.environ.get('LOCAL_TEST_REPAIR_ENABLED')!='true': return snapshot
    rev=conn.execute('SELECT revision FROM metadata.test_revision WHERE domain=%s',(domain,)).fetchone()[0]
    p,t=('prod_snapshot','test_env') if domain=='CUSTOMER_LENDING' else ('prod_cards','test_cards')
    snapshot['test_demand_measurement']={'metric_key':recipe(domain)['metric_key'],'usable':measured(groups[t],domain),'prod_count':measured(groups[p],domain),'revision':rev}
    return snapshot

def live_count(conn,domain,pred=None):
    query,params=model.count_query(domain,pred or model.named_predicate(domain))
    return conn.execute(query,params).fetchone()['n']

def latest(conn,domain):
    recipe(domain)
    row=conn.execute("SELECT run_id,result FROM metadata.analysis_run WHERE domain=%s AND status='SUCCEEDED' ORDER BY completed_at DESC LIMIT 1",(domain,)).fetchone()
    if not row:raise RepairError('Re-run analysis before defining QA demand')
    return row


def count_value(value):
    return type(value) is int and value>=0


def definitions(snapshot,domain):
    """Explicit typed evidence, never titles or LLM guesses, defines capability."""
    from app.engine import describe_state
    output={}
    rate='multi_account_rate' if domain=='CUSTOMER_LENDING' else 'multi_active_card_rate'
    f=next((f for f in snapshot['findings'] if f['finding_type']=='REPRESENTATION_GAP' and f['evidence'].get('metric')==rate),None)
    count_key='customers_2plus_active_accounts' if domain=='CUSTOMER_LENDING' else 'entities_2plus_active_cards'
    p,t=snapshot['overview']['environments'];metrics=snapshot['overview']['business_metrics']
    prod_count=metrics[p].get(count_key);test_count=metrics[t].get(count_key)
    if count_value(prod_count) and count_value(test_count):
        label='Customers with two or more active cards' if domain=='CARDS' else 'Customers with two or more active accounts'
        output[rate]={'metric_key':rate,'label':label,'human_label':label,'usable':test_count,'prod_count':prod_count,'representation':'MISSING' if test_count==0 else ('UNDERREPRESENTED' if f else 'REPRESENTED'),'unit':'customers','finding':f or qa_finding(domain,rate,label,prod_count,test_count,snapshot,{'metric':rate},unit='customers'),'repairCapability':'NOT_AVAILABLE'}
    # All states are addressable so a saved requirement survives a resolved finding.
    for state in snapshot['coverage']['states']:
        if not all(count_value(state.get(k)) for k in ['test_count','prod_count']):continue
        key='state:'+state['state_id'];f=next((f for f in snapshot['findings'] if f['evidence'].get('state_id')==state['state_id']),None)
        label=state.get('label') or describe_state(state['features'])
        if f is None:
            f=qa_finding(domain,key,label,state['prod_count'],state['test_count'],snapshot,{'state_id':state['state_id'],**state})
        output[key]={'metric_key':key,'label':label,'human_label':label,'usable':state['test_count'],'prod_count':state['prod_count'],'representation':state['assessment'],'unit':'cards' if domain=='CARDS' else 'customers','finding':f,'repairCapability':'NOT_AVAILABLE'}
    m=snapshot.get('test_demand_measurement')
    if m:
        r=recipe(domain);overview=snapshot['overview'];prod,test=overview['environments'];total='card_count' if domain=='CARDS' else 'customer_count'
        pt=overview['business_metrics'][prod][total];tt=overview['business_metrics'][test][total]
        representation='MISSING' if m['usable']==0 else ('UNDERREPRESENTED' if pt and tt and m['usable']/tt<m['prod_count']/pt*.5 else 'REPRESENTED')
        human='Active credit cards with available limit from multi-card customers' if domain=='CARDS' else 'At least two active accounts and at least one blocked account'
        output[r['metric_key']]={**r,**m,'human_label':human,'representation':representation,'repairCapability':'AUTOMATED','finding':qa_finding(domain,r['metric_key'],human,m['prod_count'],m['usable'],snapshot,{'metric':r['metric_key'],'definition':r['label']})}
    for key,d in output.items():
        if key.startswith('state:'):
            state=next(s for s in snapshot['coverage']['states'] if 'state:'+s['state_id']==key)
            pred=model.state_predicate(domain,state['features'])
        elif key==rate:pred=model.headline_predicate(domain)
        else:pred=model.named_predicate(domain)
        capability,reason=model.capability(domain,key,pred)
        d.update(predicate=pred,capability=capability,unsupported_reason=reason,
            repairCapability='AUTOMATED' if capability=='POPULATION_REPAIR_AUTOMATED' else 'NOT_AVAILABLE')
    return output


def qa_finding(domain,key,title,prod,test,snapshot,evidence,*,unit=None):
    return {'finding_id':'qa:'+domain+':'+key,'finding_type':'QA_DEMAND','title':title,'prod_value':prod,'test_value':test,'severity':'INFO','assessment':'QA review','explanation':'A measured TEST population for QA regression planning.','explanation_ready':{},'generated_at':snapshot['generated_at'],'evidence':{**evidence,'unit':unit or ('cards' if domain=='CARDS' else 'customers'),'metric_key':key,'calculation_method':'Count from the latest saved analysis; QA defines required capacity.'}}


def status(conn,domain,metric_key=None,*,row=None,definition=None):
    key=metric_key or recipe(domain)['metric_key'];row=row or latest(conn,domain);snapshot=row['result']
    d=definition or definitions(snapshot,domain).get(key)
    if d is None:raise RepairError('This finding does not support count-based QA demand')
    required=conn.execute('SELECT * FROM metadata.test_requirement WHERE domain=%s AND metric_key=%s',(domain,key)).fetchone()
    revision=conn.execute('SELECT revision FROM metadata.test_revision WHERE domain=%s',(domain,)).fetchone()['revision']
    measured_revision=snapshot.get('test_demand_measurement',{}).get('revision')
    fresh=revision==measured_revision;usable=d['usable'];need=max(required['required_usable_count']-usable,0) if required else None
    last=conn.execute("SELECT * FROM metadata.test_repair WHERE domain=%s AND metric_key=%s AND repair_family='POPULATION' ORDER BY revision DESC LIMIT 1",(domain,key)).fetchone()
    verified=bool(fresh and last and last['revision']<=measured_revision and required and last['required_count']==required['required_usable_count'] and need==0)
    pending=bool(not fresh and last and last['revision']>(measured_revision if measured_revision is not None else -1))
    qa='NEEDS_QA_REVIEW' if not required else ('REPAIR_PENDING_VERIFICATION' if pending else ('NEED_DEFINED' if not fresh else ('REPAIR_VERIFIED' if verified else ('INSUFFICIENT' if need else 'SUFFICIENT'))))
    if last and fresh and measured_revision>=last['revision'] and required and last['required_count']==required['required_usable_count']:record_verification(conn,last,row['run_id'],need==0)
    return {**d,'domain':domain,'demandCapability':'COUNT_BASED','required':required['required_usable_count'] if required else None,'reason':required['reason'] if required else '', 'needed':need,'sufficiency':'NOT_EVALUATED' if not required or not fresh else ('SUFFICIENT' if need==0 else 'INSUFFICIENT'),'qa_status':qa,'fresh':fresh,'analysis_run_id':str(row['run_id']),'revision':revision,'repair_status':'REPAIR_VERIFIED' if verified else ('AWAITING_ANALYSIS' if not fresh else 'NOT_VERIFIED'),'last_repair':{'before':last['before_count'],'required':last['required_count'],'added':last['added_count']} if last else None,'removable':owned_count(conn,domain,key) if d['repairCapability']=='AUTOMATED' else 0}


def findings_status(conn,domain):
    row=latest(conn,domain);snapshot=row['result'];defs=definitions(snapshot,domain)
    required={r['metric_key'] for r in conn.execute('SELECT metric_key FROM metadata.test_requirement WHERE domain=%s',(domain,)).fetchall()}
    active_ids={f['finding_id'] for f in snapshot['findings']}
    entries=[status(conn,domain,key,row=row,definition=d) for key,d in defs.items() if key in required or key==recipe(domain)['metric_key'] or d['finding']['finding_id'] in active_ids]
    ids={d['finding']['finding_id'] for d in entries}
    health=health_status(conn,domain,row=row)
    for f in snapshot['findings']:
        if f['finding_type']=='DATA_HEALTH_ISSUE' and f['evidence'].get('metric')==health['metric_key']:
            entries.append(health);ids.add(f['finding_id'])
        if f['finding_id'] not in ids:
            entries.append({'finding':f,'demandCapability':'NONE','repairCapability':'NOT_AVAILABLE','capability':'HEALTH_REPAIR_GUIDED' if f['finding_type']=='DATA_HEALTH_ISSUE' else 'NO_AUTOMATED_REPAIR','exclusion_reason':{'DATA_HEALTH_ISSUE':'Health violations require a separate data-quality model, not a usable population target.','FRESHNESS_GAP':'Freshness is a time measurement, not a regression population count.'}.get(f['finding_type'],'No deterministic usable population definition is available.')})
    if health['last_repair'] and health['finding']['finding_id'] not in {e['finding']['finding_id'] for e in entries}:entries.append(health)
    return entries

def lock(conn):
    if not conn.execute('SELECT pg_try_advisory_xact_lock(%s) AS ok',(LOCK,)).fetchone()['ok']:raise RepairError('Analysis or repair is already running; try after it completes')
    conn.execute("SET LOCAL statement_timeout='30s'")

def save(conn,domain,required,reason='',metric_key=None):
    key=metric_key or recipe(domain)['metric_key']
    status(conn,domain,key)  # Reject unsupported/unknown keys before any write.
    if type(required) is not int or not 0<=required<=2147483647:raise RepairError('Required count must be a non-negative 32-bit integer')
    if not isinstance(reason,str) or len(reason)>500:raise RepairError('Reason must be at most 500 characters')
    lock(conn)
    conn.execute('INSERT INTO metadata.test_requirement(domain,metric_key,required_usable_count,reason) VALUES (%s,%s,%s,%s) ON CONFLICT(domain,metric_key) DO UPDATE SET required_usable_count=excluded.required_usable_count,reason=excluded.reason,updated_at=now()',(domain,key,required,reason))
    return status(conn,domain,key)

def plan_context(conn,domain):
    query="SELECT max(created_at) AS t FROM test_env.customer" if domain=='CUSTOMER_LENDING' else "SELECT max(changed_at) AS t FROM test_cards.card_status_history"
    timestamp=conn.execute(query).fetchone()['t']
    if timestamp is None:raise RepairError('No TEST reference timestamp; reprovision the synthetic demo')
    return timestamp


def preview(conn,domain,metric_key=None):
    s=status(conn,domain,metric_key)
    if s['repairCapability']!='AUTOMATED':raise RepairError(s['unsupported_reason'] or 'Automatic repair not available for this count finding')
    if not s['fresh'] or live_count(conn,domain,s['predicate'])!=s['usable']:raise RepairError('TEST changed; re-run analysis before preview/apply')
    if not s['needed']:raise RepairError('No positive repair gap; save a higher regression need first')
    plan=model.population_plan(domain,s['metric_key'],s['predicate'],s['needed'])
    context={k:s[k] for k in ['domain','metric_key','usable','required','revision','analysis_run_id']}
    context.update(plan=plan.canonical(),timestamp=plan_context(conn,domain).isoformat())
    token=hashlib.sha256(json.dumps(context,sort_keys=True).encode()).hexdigest()
    return {**s,'token':token,'plan':plan.canonical(),'plan_hash':plan.digest(),'physical_rows':plan.physical_rows(),
        'qualifying_business_states':s['needed'],'total_physical_rows':sum(plan.physical_rows().values()),
        'sql':sql_preview(plan),'note':'Canonical graph rendered as parameterized PostgreSQL. Bound values and symbolic IDs are shown below; the same plan is checked at apply.'}


def statements(plan):
    # Kept as the executor seam for rollback tests; there is no metric-specific SQL.
    return model.statements(plan)


def sql_preview(plan):
    return 'BEGIN;\n-- Recheck snapshot, live predicate count, plan hash and revision.\n'+'\n'.join(statement+'; -- '+json.dumps(dict(zip(model.GRAPH[plan.domain][row.table],row.values)),sort_keys=True) for statement,row in zip(statements(plan),plan.rows))+'\n-- Repeated for each qualifying unit; validate exact count and record provenance.\nCOMMIT;'


def require_demo(conn,domain):
    table='demo_dataset' if domain=='CUSTOMER_LENDING' else 'cards_dataset'
    expected=20261010 if domain=='CUSTOMER_LENDING' else 20261012
    row=conn.execute('SELECT seed FROM metadata.'+table+' WHERE singleton=true').fetchone()
    if not row or row['seed']!=expected:raise RepairError('Only the local synthetic demo dataset is repairable')

def record_verification(conn,last,run_id,passed):
    if last:
        conn.execute('UPDATE metadata.test_repair SET verification_analysis_id=%s,verification_result=%s WHERE repair_id=%s AND verification_analysis_id IS DISTINCT FROM %s::uuid',(run_id,'PASS' if passed else 'FAIL',last['repair_id'],run_id))


def audit(conn,domain,key,family,before,target,affected,rows,action,plan_hash,before_run,plan):
    rev=conn.execute('UPDATE metadata.test_revision SET revision=revision+1 WHERE domain=%s RETURNING revision',(domain,)).fetchone()['revision'];rid=uuid4()
    conn.execute("""INSERT INTO metadata.test_repair(repair_id,domain,metric_key,before_count,required_count,added_count,revision,
        repair_family,plan_hash,affected_entity_count,physical_row_count,action_type,before_analysis_id,canonical_plan)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)""",
        (rid,domain,key,before,target,affected,rev,family,plan_hash,affected,rows,action,before_run,json.dumps(plan,sort_keys=True)))
    return rid


def apply(conn,domain,token,metric_key=None):
    lock(conn);p=preview(conn,domain,metric_key)
    if token!=p['token']:raise RepairError('Stale preview: confirm a fresh repair plan')
    require_demo(conn,domain)
    plan=model.population_plan(domain,p['metric_key'],p['predicate'],p['needed'])
    ids=[-1000*conn.execute("SELECT nextval('metadata.test_repair_id') AS id").fetchone()['id'] for _ in range(p['needed'])]
    timestamp=plan_context(conn,domain)
    for root in ids:
        for statement,row in zip(statements(plan),plan.rows,strict=True):conn.execute(statement,model.bindings(row,root,timestamp))
    if live_count(conn,domain,p['predicate'])!=p['usable']+p['needed']:raise RepairError('Inserted states did not match the canonical predicate; rolled back')
    rid=audit(conn,domain,p['metric_key'],'POPULATION',p['usable'],p['required'],p['needed'],p['total_physical_rows'],'INSERT',p['plan_hash'],p['analysis_run_id'],p['plan'])
    for entity in ids:conn.execute('INSERT INTO metadata.test_repair_entity VALUES (%s,%s,%s)',(domain,entity,rid))
    return {'status':'APPLIED','added':p['needed'],'physical_rows':p['physical_rows'],'verification':'AWAITING_ANALYSIS'}


def owned_count(conn,domain,key):
    return conn.execute('SELECT count(*) AS n FROM metadata.test_repair_entity e JOIN metadata.test_repair r USING(repair_id) WHERE e.domain=%s AND r.metric_key=%s',(domain,key)).fetchone()['n']


def inject(conn,domain,count,metric_key=None):
    key=metric_key or recipe(domain)['metric_key'];s=status(conn,domain,key)
    if s['repairCapability']!='AUTOMATED':raise RepairError('Automatic repair not available for this count finding')
    if type(count) is not int or not 1<=count<=MAX_REPAIR:raise RepairError('Inject count must be an integer from 1 to 100')
    lock(conn);require_demo(conn,domain)
    removable=owned_count(conn,domain,key)
    if count>removable:raise RepairError(f'Maximum removable: {removable}')
    ids=[r['entity_id'] for r in conn.execute('SELECT e.entity_id FROM metadata.test_repair_entity e JOIN metadata.test_repair r USING(repair_id) WHERE e.domain=%s AND r.metric_key=%s ORDER BY e.entity_id LIMIT %s',(domain,key,count)).fetchall()]
    if len(ids)!=count or any(i>=0 for i in ids):raise RepairError('Only repair-created synthetic entities may be removed')
    before=live_count(conn,domain,s['predicate'])
    if domain=='CUSTOMER_LENDING':
        for table in ['account','loan','card']:conn.execute('DELETE FROM test_env.'+table+' WHERE customer_id=ANY(%s)',(ids,))
        conn.execute('DELETE FROM test_env.customer WHERE customer_id=ANY(%s)',(ids,))
    else:
        for table in ['card_status_history','card_account','card_limit']:
            conn.execute('DELETE FROM test_cards.'+table+' WHERE card_id IN (SELECT card_id FROM test_cards.card WHERE customer_id=ANY(%s))',(ids,))
        conn.execute('DELETE FROM test_cards.card WHERE customer_id=ANY(%s)',(ids,));conn.execute('DELETE FROM test_cards.funding_account WHERE customer_id=ANY(%s)',(ids,));conn.execute('DELETE FROM test_cards.card_customer WHERE customer_id=ANY(%s)',(ids,))
    if live_count(conn,domain,s['predicate'])!=before-count:raise RepairError('Unexpected inject impact; rolled back')
    conn.execute('DELETE FROM metadata.test_repair_entity WHERE domain=%s AND entity_id=ANY(%s)',(domain,ids));conn.execute('UPDATE metadata.test_revision SET revision=revision+1 WHERE domain=%s',(domain,))
    return {'status':'GAP_INJECTED','removed':count,'verification':'AWAITING_ANALYSIS'}


def health_status(conn,domain,*,row=None):
    recipe(domain);row=row or latest(conn,domain);snapshot=row['result'];rule=model.HEALTH_RULES[domain];key=rule['metric_key']
    p,t=snapshot['overview']['environments'];metrics=snapshot['overview']['business_metrics']
    violations=metrics[t][key]
    revision=conn.execute('SELECT revision FROM metadata.test_revision WHERE domain=%s',(domain,)).fetchone()['revision']
    measured_revision=snapshot.get('test_demand_measurement',{}).get('revision');fresh=revision==measured_revision
    last=conn.execute("SELECT * FROM metadata.test_repair WHERE domain=%s AND metric_key=%s AND repair_family='HEALTH' ORDER BY revision DESC LIMIT 1",(domain,key)).fetchone()
    verified=bool(last and fresh and measured_revision>=last['revision'] and violations==0)
    pending=bool(last and last['revision']>(measured_revision if measured_revision is not None else -1))
    if last and fresh and measured_revision>=last['revision']:record_verification(conn,last,row['run_id'],violations==0)
    f=next((f for f in snapshot['findings'] if f['finding_type']=='DATA_HEALTH_ISSUE' and f['evidence'].get('metric')==key),None)
    if f is None:
        f=qa_finding(domain,key,rule['label'],metrics[p][key],violations,snapshot,{'metric':key,'rule_key':rule['rule_key']})
        f['finding_type']='HEALTH_REVIEW';f['explanation']='Local policy correction is measured by a fresh analysis; allowed violations: 0.'
    policy=rule.get('policy')
    return {'domain':domain,'metric_key':key,'label':rule['label'],'rule_key':rule['rule_key'],'predicate':rule['predicate'],
        'finding':f,'demandCapability':'NONE','repairCapability':'AUTOMATED' if policy else 'NOT_AVAILABLE',
        'capability':'HEALTH_REPAIR_AUTOMATED' if policy else 'HEALTH_REPAIR_GUIDED','violations':violations,'allowed':0,'policy':policy,
        'health_status':'DATA_HEALTH_VERIFIED' if verified else ('REPAIR_PENDING_VERIFICATION' if pending else ('REPAIR_AVAILABLE' if policy and violations else 'HEALTH_REVIEW')),
        'fresh':fresh,'revision':revision,'analysis_run_id':str(row['run_id']),'last_repair':{'affected':last['affected_entity_count'],'physical_rows':last['physical_row_count']} if last else None}


def health_preview(conn,domain):
    s=health_status(conn,domain);rule=model.HEALTH_RULES[domain]
    if not s['policy']:raise RepairError('No approved automated correction policy')
    if not s['fresh'] or live_count(conn,domain,rule['predicate'])!=s['violations']:raise RepairError('TEST changed; re-run analysis before health preview')
    if not s['violations']:raise RepairError('No health violations to correct')
    query,params,_=model.health_targets(domain,rule);ids=[r['id'] for r in conn.execute(query,params).fetchall()]
    if not ids or len(ids)>10000:raise RepairError('Health policy supports 1 to 10000 affected TEST rows per operation')
    plan={'repair_family':'HEALTH','domain':domain,'metric_key':s['metric_key'],'rule_key':s['rule_key'],'policy':s['policy'],
        'target_ids':ids,'affected_entity_count':s['violations'],'physical_row_count':len(ids),'revision':s['revision'],'before_analysis_id':s['analysis_run_id'],'version':1}
    digest=hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest()
    return {**s,'token':digest,'plan':plan,'plan_hash':digest,'affected_entities':s['violations'],
        'physical_rows':{s['policy']['table']:len(ids)},'total_physical_rows':len(ids),
        'sql':'BEGIN;\n'+model.health_statement(domain,rule)+';\nCOMMIT;','note':'Approved SET policy only. Value and exact target IDs are bound at apply; target zero violations.'}


def health_apply(conn,domain,token):
    lock(conn);p=health_preview(conn,domain)
    if token!=p['token']:raise RepairError('Stale preview: confirm a fresh health plan')
    require_demo(conn,domain);rule=model.HEALTH_RULES[domain]
    changed=conn.execute(model.health_statement(domain,rule),(rule['policy']['value'],p['plan']['target_ids'])).rowcount
    if changed!=p['total_physical_rows'] or live_count(conn,domain,rule['predicate'])!=0:raise RepairError('Health target not met; rolled back')
    audit(conn,domain,p['metric_key'],'HEALTH',p['violations'],0,p['affected_entities'],changed,'SET',p['plan_hash'],p['analysis_run_id'],p['plan'])
    return {'status':'APPLIED','corrected':p['affected_entities'],'physical_rows':changed,'verification':'AWAITING_ANALYSIS'}
