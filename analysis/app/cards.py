"""Cards relational adapter; fingerprint, coverage and findings evaluators are shared."""
from datetime import datetime, timezone
from psycopg.rows import dict_row
from app.engine import table_fingerprints, metric, coverage, findings, serial, describe_state
SCHEMAS=('prod_cards','test_cards')
from app.repair_model import STATE_FEATURES
FEATURES = STATE_FEATURES['CARDS']
TABLES={
 'card':['card_id','customer_id','card_type','status','physical_virtual','created_at'],
 'card_account':['card_id','account_id','relationship_type'],
 'card_limit':['card_id','total_limit','available_limit','effective_at'],
 'card_status_history':['history_id','card_id','status','changed_at'],
 'card_customer':['customer_id'], 'funding_account':['account_id','customer_id']}
DATES={'card':'created_at','card_limit':'effective_at','card_status_history':'changed_at'}

def grouped_features(conn, env):
    from app.repair_model import measurement_query
    with conn.cursor(row_factory=dict_row) as cur:
        return cur.execute(measurement_query('CARDS',env)).fetchall()

def business_metrics(conn,env):
    from app.repair_model import CLOSED_CARD_VIOLATION
    with conn.cursor(row_factory=dict_row) as cur:
        totals=cur.execute(f'''WITH entities AS (SELECT customer_id,COUNT(*) FILTER(WHERE status='ACTIVE') AS active,
         COUNT(DISTINCT physical_virtual)>1 AS mixed FROM {env}.card GROUP BY customer_id)
         SELECT COUNT(*) AS entity_count,COUNT(*) FILTER(WHERE active=0) AS entities_0_active_cards,
         COUNT(*) FILTER(WHERE active=1) AS entities_1_active_card,COUNT(*) FILTER(WHERE active>=2) AS entities_2plus_active_cards,
         COUNT(*) FILTER(WHERE mixed) AS entities_with_physical_and_virtual FROM entities''').fetchone()
        totals.update(cur.execute(f'''SELECT COUNT(*) AS card_count,
         COUNT(*) FILTER(WHERE c.status='ACTIVE') AS active_cards, COUNT(*) FILTER(WHERE c.status='CLOSED') AS closed_cards,
         COUNT(*) FILTER(WHERE c.status='BLOCKED') AS blocked_cards,
         COUNT(*) FILTER(WHERE physical_virtual='PHYSICAL') AS physical_cards,
         COUNT(*) FILTER(WHERE physical_virtual='VIRTUAL') AS virtual_cards,
         COUNT(*) FILTER(WHERE card_type='DEBIT') AS debit_cards, COUNT(*) FILTER(WHERE card_type='CREDIT') AS credit_cards,
         COUNT(*) FILTER(WHERE total_limit>=50000) AS high_limit_cards,
         COUNT(*) FILTER(WHERE available_limit>0) AS positive_available_limit_cards,
         COUNT(*) FILTER(WHERE {CLOSED_CARD_VIOLATION}) AS closed_cards_with_available_limit
         FROM {env}.card c LEFT JOIN {env}.card_limit l USING(card_id)''').fetchone())
    totals['multi_active_card_rate']=totals['entities_2plus_active_cards']/totals['entity_count'] if totals['entity_count'] else None
    totals['physical_virtual_combination_rate']=totals['entities_with_physical_and_virtual']/totals['entity_count'] if totals['entity_count'] else None
    for name,key in [('active_card_rate','active_cards'),('closed_card_rate','closed_cards'),('physical_card_rate','physical_cards'),('virtual_card_rate','virtual_cards'),('high_limit_rate','high_limit_cards'),('positive_available_limit_rate','positive_available_limit_cards')]:
        totals[name]=totals[key]/totals['card_count'] if totals['card_count'] else None
    return totals

def analyze_cards(conn,run_id,now=None):
    now=now or datetime.now(timezone.utc);timestamp=now.isoformat()
    conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
    conn.execute("SET LOCAL statement_timeout='90s'");conn.execute("SET LOCAL work_mem='16MB'")
    with conn.cursor(row_factory=dict_row) as cur:
        dataset=cur.execute('SELECT seed,entities_per_environment,reference_timestamp,generator_version FROM metadata.cards_dataset WHERE singleton=true').fetchone()
    if not dataset:raise ValueError('Cards data has not been seeded')
    metrics=[];groups={};business={};latest={}
    for env in SCHEMAS:
        table_metrics,latest[env]=table_fingerprints(conn,env,timestamp,TABLES,DATES);metrics.extend(table_metrics)
        groups[env]=grouped_features(conn,env);business[env]=business_metrics(conn,env)
        for key,value in business[env].items():metrics.append(metric(key,env,value,'card relationships',timestamp,'PostgreSQL bounded per-entity aggregates; card/limit one-to-one join'))
        predicates={
         'orphan_cards':f'SELECT COUNT(*) FROM {env}.card c LEFT JOIN {env}.card_customer e USING(customer_id) WHERE e.customer_id IS NULL',
         'missing_limits':f'SELECT COUNT(*) FROM {env}.card c LEFT JOIN {env}.card_limit l USING(card_id) WHERE l.card_id IS NULL',
         'missing_card_accounts':f'SELECT COUNT(*) FROM {env}.card c WHERE NOT EXISTS(SELECT 1 FROM {env}.card_account a WHERE a.card_id=c.card_id)',
         'orphan_card_accounts':f'SELECT COUNT(*) FROM {env}.card_account a LEFT JOIN {env}.funding_account f USING(account_id) WHERE f.account_id IS NULL',
         'orphan_history':f'SELECT COUNT(*) FROM {env}.card_status_history h LEFT JOIN {env}.card c USING(card_id) WHERE c.card_id IS NULL'}
        for key,query in predicates.items():metrics.append(metric(key,env,conn.execute(query).fetchone()[0],'relationship health',timestamp,query))
        metrics.append(metric('latest_business_timestamp',env,latest[env],'freshness',timestamp,'MAX across card/limit/status business timestamps'))
    states=coverage(groups[SCHEMAS[0]],groups[SCHEMAS[1]],features=FEATURES)
    for state in states["states"]: state["label"]=describe_state(state["features"])
    p,t=latest[SCHEMAS[0]],latest[SCHEMAS[1]]
    freshness={'prod_latest':serial(p),'test_latest':serial(t),'age_difference_days':(p-t).total_seconds()/86400 if p and t else None,'test_age_days':(now-t).total_seconds()/86400 if t else None}
    fs=findings(run_id,business[SCHEMAS[0]],business[SCHEMAS[1]],states,freshness,timestamp,domain='CARDS')
    overview={'reality_gaps':sum(f['finding_type']=='REPRESENTATION_GAP' for f in fs),'data_health_issues':sum(f['finding_type']=='DATA_HEALTH_ISSUE' for f in fs),'missing_data_states':states['missing_in_test'],'test_data_age_days':freshness['test_age_days'],'business_metrics':business,'freshness':freshness,'environments':list(SCHEMAS)}
    from app.local_repair import attach
    return attach({'domain':'CARDS','run_id':run_id,'generated_at':timestamp,'dataset':{k:serial(v) for k,v in dataset.items()},'overview':overview,'fingerprints':metrics,'coverage':states,'findings':fs},groups,'CARDS',conn)
