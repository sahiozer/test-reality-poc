import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo, conninfo_to_dict
import pytest
from app import local_repair as r
from app.engine import analyze


def publish(dsn,domain):
    run=str(uuid4())
    with psycopg.connect(dsn) as conn: snapshot=analyze(conn,run,domain=domain)
    with psycopg.connect(dsn) as conn:
        conn.execute("INSERT INTO metadata.analysis_run(run_id,status,domain,completed_at,result) VALUES (%s,'SUCCEEDED',%s,now(),%s::jsonb)",(run,domain,json.dumps(snapshot)))
    return snapshot


@pytest.fixture(params=['CUSTOMER_LENDING','CARDS'])
def repair_case(request,monkeypatch):
    admin=os.environ['TEST_DATABASE_URL'];name='test_reality_repair_checks_'+uuid4().hex[:12]
    with psycopg.connect(admin,autocommit=True) as conn:conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    dsn=make_conninfo(admin,dbname=name);password=conninfo_to_dict(os.environ['REPAIR_DATABASE_URL'])['password']
    monkeypatch.setenv('DATABASE_URL',dsn);monkeypatch.setenv('REPAIR_DATABASE_URL',make_conninfo(dsn,user='test_reality_repair',password=password));monkeypatch.setenv('LOCAL_TEST_REPAIR_ENABLED','true')
    try:
        with psycopg.connect(dsn) as conn:
            conn.execute(Path('/app/init.sql').read_text());conn.execute(Path('/app/cards.sql').read_text())
            conn.execute("INSERT INTO metadata.demo_dataset VALUES (true,20261010,1,'2026-10-10','test',now())")
            conn.execute("INSERT INTO metadata.cards_dataset VALUES (true,20261012,1,'2026-10-10','test')")
            for env in ['prod_snapshot','test_env']:
                conn.execute(sql.SQL("INSERT INTO {}.customer VALUES (1,'RETAIL','OPEN','STANDARD','2026-08-26')").format(sql.Identifier(env)))
                conn.execute(sql.SQL("INSERT INTO {}.account VALUES (1,1,'CURRENT','TRY','ACTIVE',true,'2026-08-26'),(2,1,'CURRENT','TRY','ACTIVE',false,'2026-08-26')").format(sql.Identifier(env)))
            for env in ['prod_cards','test_cards']:
                conn.execute(sql.SQL('INSERT INTO {}.card_customer VALUES (1)').format(sql.Identifier(env)))
                conn.execute(sql.SQL('INSERT INTO {}.funding_account VALUES (1,1)').format(sql.Identifier(env)))
                conn.execute(sql.SQL("INSERT INTO {}.card VALUES (1,1,'CREDIT','ACTIVE','PHYSICAL','2026-09-10'),(2,1,'DEBIT','ACTIVE','PHYSICAL','2026-09-10')").format(sql.Identifier(env)))
                conn.execute(sql.SQL("INSERT INTO {}.card_account VALUES (1,1,'PRIMARY'),(2,1,'PRIMARY')").format(sql.Identifier(env)))
                conn.execute(sql.SQL("INSERT INTO {}.card_limit VALUES (1,30000,10000,'2026-09-10'),(2,30000,10000,'2026-09-10')").format(sql.Identifier(env)))
                conn.execute(sql.SQL("INSERT INTO {}.card_status_history VALUES (1,1,'ACTIVE','2026-09-10'),(2,2,'ACTIVE','2026-09-10')").format(sql.Identifier(env)))
        r.initialize();publish(dsn,request.param)
        yield dsn,request.param
    finally:
        with psycopg.connect(admin,autocommit=True) as conn:conn.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))


def test_requirements_states_and_invalid_input(repair_case):
    _,domain=repair_case
    with r.connection() as conn:
        assert r.status(conn,domain)['sufficiency']=='NOT_EVALUATED'
        for invalid in [-1,1.5,True,'2',None]:
            with pytest.raises(r.RepairError):r.save(conn,domain,invalid)
        assert r.save(conn,domain,0)['sufficiency']=='SUFFICIENT'
        assert r.save(conn,domain,1,'one case')['needed']==0
        s=r.save(conn,domain,3);assert s['needed']==2 and s['sufficiency']=='INSUFFICIENT' and s['representation']=='REPRESENTED'
    with r.connection() as conn:assert r.status(conn,domain)['required']==3


def test_preview_apply_rerun_and_inject(repair_case):
    dsn,domain=repair_case
    with r.connection() as conn:r.save(conn,domain,3)
    with r.connection() as conn:
        p=r.preview(conn,domain);assert p['needed']==2
        assert p['physical_rows']=={k:2*v for k,v in r.recipe(domain)['tables'].items()}
        assert all(statement in p['sql'] for statement in r.statements(r.model.population_plan(domain,r.recipe(domain)['metric_key'],r.model.named_predicate(domain),2)))
        assert 'prod_snapshot' not in p['sql'] and 'prod_cards' not in p['sql']
        assert r.apply(conn,domain,p['token'])['added']==2
    with r.connection() as conn:
        s=r.status(conn,domain);assert s['usable']==1 and not s['fresh'] and s['repair_status']=='AWAITING_ANALYSIS'
        with pytest.raises(r.RepairError):r.apply(conn,domain,p['token'])
    snapshot=publish(dsn,domain);assert snapshot['test_demand_measurement']['usable']==3
    with r.connection() as conn:
        s=r.status(conn,domain);assert s['sufficiency']=='SUFFICIENT' and s['repair_status']=='REPAIR_VERIFIED'
        assert r.inject(conn,domain,2)['removed']==2
    publish(dsn,domain)
    with r.connection() as conn:
        s=r.status(conn,domain);assert s['needed']==2 and s['sufficiency']=='INSUFFICIENT' and s['repair_status']!='REPAIR_VERIFIED'
        with pytest.raises(r.RepairError):r.inject(conn,domain,1)
        assert r.live_count(conn,domain)==1  # Seeded entity never removed.


def test_stale_preview_does_not_overinsert(repair_case):
    _,domain=repair_case
    with r.connection() as conn:r.save(conn,domain,2);p=r.preview(conn,domain)
    with r.connection() as conn:r.save(conn,domain,3)
    with r.connection() as conn:
        with pytest.raises(r.RepairError):r.apply(conn,domain,p['token'])
        assert r.live_count(conn,domain)==1


def test_failure_rolls_back_partial_inserts(repair_case,monkeypatch):
    _,domain=repair_case
    with r.connection() as conn:r.save(conn,domain,3);p=r.preview(conn,domain)
    original=r.statements(r.model.population_plan(domain,r.recipe(domain)['metric_key'],r.model.named_predicate(domain),2))
    monkeypatch.setattr(r,'statements',lambda d:original[:1]+['SELECT 1/0'])
    with pytest.raises(psycopg.errors.DivisionByZero):
        with r.connection() as conn:r.apply(conn,domain,p['token'])
    with r.connection() as conn:
        assert r.live_count(conn,domain)==1
        assert conn.execute('SELECT count(*) AS n FROM metadata.test_repair_entity').fetchone()['n']==0
        table='test_env.customer' if domain=='CUSTOMER_LENDING' else 'test_cards.card_customer'
        assert conn.execute('SELECT count(*) AS n FROM '+table+' WHERE customer_id<0').fetchone()['n']==0


def test_prod_writes_rejected_by_database(repair_case):
    _,domain=repair_case
    for schema,table in [('prod_snapshot','customer'),('prod_cards','card_customer')]:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with r.connection() as conn:conn.execute('DELETE FROM '+schema+'.'+table)
    with r.connection() as conn:
        for invalid in ['prod_snapshot','prod_cards','UNKNOWN']:
            with pytest.raises(r.RepairError):r.preview(conn,invalid)


def test_inject_rejects_non_demo_provenance(repair_case):
    dsn,domain=repair_case
    with r.connection() as conn:r.save(conn,domain,2);p=r.preview(conn,domain);r.apply(conn,domain,p['token'])
    table='demo_dataset' if domain=='CUSTOMER_LENDING' else 'cards_dataset'
    with psycopg.connect(dsn) as conn:conn.execute('UPDATE metadata.'+table+' SET seed=0')
    with r.connection() as conn:
        with pytest.raises(r.RepairError,match='synthetic'):r.inject(conn,domain,1)
        assert r.live_count(conn,domain)==2


def missing_state(dsn,domain):
    with psycopg.connect(dsn) as conn:
        if domain=='CUSTOMER_LENDING':
            conn.execute("INSERT INTO prod_snapshot.customer SELECT id,'RETAIL','OPEN','STANDARD','2026-08-26'::timestamptz FROM generate_series(100,299) id")
        else:
            conn.execute('INSERT INTO prod_cards.card_customer SELECT id FROM generate_series(100,299) id')
            conn.execute('INSERT INTO prod_cards.funding_account SELECT id,id FROM generate_series(100,299) id')
            conn.execute("INSERT INTO prod_cards.card SELECT id,id,'DEBIT','CLOSED','PHYSICAL','2026-09-10'::timestamptz FROM generate_series(100,299) id")
            conn.execute("INSERT INTO prod_cards.card_account SELECT id,id,'PRIMARY' FROM generate_series(100,299) id")
            conn.execute("INSERT INTO prod_cards.card_limit SELECT id,30000,0,'2026-09-10'::timestamptz FROM generate_series(100,299) id")
            conn.execute("INSERT INTO prod_cards.card_status_history SELECT id,id,'CLOSED','2026-09-10'::timestamptz FROM generate_series(100,299) id")
    snapshot=publish(dsn,domain)
    return next(key for key in r.definitions(snapshot,domain) if key.startswith('state:'))


def test_generic_demand_keys_are_independent_and_survive_rerun(repair_case):
    dsn,domain=repair_case;key=missing_state(dsn,domain)
    other='CARDS' if domain=='CUSTOMER_LENDING' else 'CUSTOMER_LENDING';publish(dsn,other)
    with r.connection() as conn:
        state=r.status(conn,domain,key)
        assert state['demandCapability']=='COUNT_BASED' and state['repairCapability']=='AUTOMATED'
        assert state['qa_status']=='NEEDS_QA_REVIEW' and state['required'] is None
        assert r.save(conn,domain,5,'state need',key)['qa_status']=='INSUFFICIENT'
        assert r.save(conn,domain,3)['needed']==2
        r.save(conn,other,9)
        assert r.preview(conn,domain,key)['needed']==5
    publish(dsn,domain)
    with r.connection() as conn:
        assert r.status(conn,domain,key)['required']==5
        assert r.status(conn,domain)['required']==3
        assert r.status(conn,other)['required']==9
        assert r.save(conn,domain,0,metric_key=key)['qa_status']=='SUFFICIENT'
        assert 'sql' not in r.status(conn,domain,key)


def test_qa_statuses_and_explicit_inject_limit(repair_case):
    dsn,domain=repair_case;key=missing_state(dsn,domain)
    with r.connection() as conn:
        r.save(conn,domain,1,metric_key=key)
        assert r.save(conn,domain,1)['qa_status']=='SUFFICIENT'
        r.save(conn,domain,3);p=r.preview(conn,domain);r.apply(conn,domain,p['token'])
    with r.connection() as conn:
        assert r.status(conn,domain)['qa_status']=='REPAIR_PENDING_VERIFICATION'
        assert r.status(conn,domain,key)['qa_status']=='NEED_DEFINED'
        with pytest.raises(r.RepairError,match='Maximum removable: 2'):r.inject(conn,domain,3)
        assert r.live_count(conn,domain)==3
    publish(dsn,domain)
    with r.connection() as conn:assert r.status(conn,domain)['qa_status']=='REPAIR_VERIFIED'


def test_capability_rejects_health_freshness_and_untyped_percentages(repair_case):
    dsn,domain=repair_case;key=missing_state(dsn,domain)
    with r.connection() as conn:
        entries=r.findings_status(conn,domain)
        for e in entries:
            if e['finding']['finding_type'] in ['DATA_HEALTH_ISSUE','FRESHNESS_GAP']:assert e['demandCapability']=='NONE'
        with pytest.raises(r.RepairError):r.save(conn,domain,0,metric_key='closed_customers_with_active_accounts')
    with psycopg.connect(dsn) as conn:snapshot=analyze(conn,str(uuid4()),domain=domain)
    snapshot['findings']=[{'finding_id':'unsupported','finding_type':'REPRESENTATION_GAP','evidence':{'metric':'unknown_rate','unit':'fraction'},'title':'2+ active accounts'}]
    assert 'unknown_rate' not in r.definitions(snapshot,domain)


def test_resolved_state_remains_in_qa_list_with_saved_requirement(repair_case):
    dsn,domain=repair_case;key=missing_state(dsn,domain)
    with r.connection() as conn:r.save(conn,domain,2,metric_key=key)
    # Fixture-only source update simulates a population supplied outside automation.
    with psycopg.connect(dsn) as conn:
        if domain=='CUSTOMER_LENDING':
            conn.execute('INSERT INTO test_env.customer SELECT * FROM prod_snapshot.customer WHERE customer_id>=100')
        else:
            for table,column in [('card_customer','customer_id'),('funding_account','account_id'),('card','card_id'),('card_account','card_id'),('card_limit','card_id'),('card_status_history','history_id')]:
                conn.execute('INSERT INTO test_cards.'+table+' SELECT * FROM prod_cards.'+table+' WHERE '+column+'>=100')
    publish(dsn,domain)
    with r.connection() as conn:
        entry=next(e for e in r.findings_status(conn,domain) if e.get('metric_key')==key)
        assert entry['usable']==200 and entry['qa_status']=='SUFFICIENT'
        assert entry['representation']=='REPRESENTED' and entry['finding']['finding_type']=='QA_DEMAND'
        assert entry['required']==2 and entry['repairCapability']=='AUTOMATED'


def test_headline_population_key_remains_addressable_without_a_gap(repair_case):
    dsn,domain=repair_case;key='multi_account_rate' if domain=='CUSTOMER_LENDING' else 'multi_active_card_rate'
    with r.connection() as conn:
        assert r.status(conn,domain,key)['usable']==1
        r.save(conn,domain,1,metric_key=key)
    publish(dsn,domain)
    with r.connection() as conn:
        entry=next(e for e in r.findings_status(conn,domain) if e.get('metric_key')==key)
        assert entry['qa_status']=='SUFFICIENT' and entry['required']==1 and entry['repairCapability']=='AUTOMATED'
        assert entry['unit']=='customers'
        assert entry['finding']['finding_type']=='QA_DEMAND'
        assert entry['finding']['evidence']['unit']=='customers'
