import json
from uuid import uuid4
import psycopg
import pytest
from app import local_repair as r
from test_local_repair import repair_case, publish, missing_state


def test_generic_state_and_headline_lifecycle_and_audit(repair_case):
    dsn,domain=repair_case;state=missing_state(dsn,domain)
    keys=[state,'multi_account_rate' if domain=='CUSTOMER_LENDING' else 'multi_active_card_rate']
    for key in keys:
        with r.connection() as conn:
            s=r.status(conn,domain,key);before=s['usable'];r.save(conn,domain,before+2,metric_key=key)
            p=r.preview(conn,domain,key);assert p['plan']['metric_key']==key and p['total_physical_rows']>0
            r.apply(conn,domain,p['token'],key)
        with r.connection() as conn:assert r.status(conn,domain,key)['qa_status']=='REPAIR_PENDING_VERIFICATION'
        publish(dsn,domain)
        with r.connection() as conn:
            assert r.status(conn,domain,key)['qa_status']=='REPAIR_VERIFIED'
            audit=conn.execute('SELECT * FROM metadata.test_repair WHERE metric_key=%s',(key,)).fetchone()
            assert audit['repair_family']=='POPULATION' and audit['plan_hash']==p['plan_hash']
            assert audit['verification_result']=='PASS' and str(audit['verification_analysis_id'])==r.status(conn,domain,key)['analysis_run_id']
            assert audit['affected_entity_count']==2 and audit['physical_row_count']==p['total_physical_rows']
            assert r.inject(conn,domain,2,key)['removed']==2
        publish(dsn,domain)
        with r.connection() as conn:assert r.status(conn,domain,key)['usable']==before


def seed_health(dsn,domain):
    with psycopg.connect(dsn) as conn:
        if domain=='CUSTOMER_LENDING':conn.execute("UPDATE test_env.customer SET status='CLOSED' WHERE customer_id=1")
        else:conn.execute("UPDATE test_cards.card SET status='CLOSED' WHERE card_id=1")
    publish(dsn,domain)


def test_health_separate_policy_preview_pending_rerun_verification(repair_case):
    dsn,domain=repair_case;seed_health(dsn,domain)
    with r.connection() as conn:
        s=r.health_status(conn,domain);assert s['demandCapability']=='NONE' and s['violations']==1 and s['allowed']==0
        assert s['policy']['action']=='SET'
        with pytest.raises(r.RepairError):r.save(conn,domain,5,metric_key=s['metric_key'])
        p=r.health_preview(conn,domain);assert p['affected_entities']==1
        assert p['total_physical_rows']==(2 if domain=='CUSTOMER_LENDING' else 1)
        assert r.health_apply(conn,domain,p['token'])['verification']=='AWAITING_ANALYSIS'
    with r.connection() as conn:
        assert r.health_status(conn,domain)['health_status']=='REPAIR_PENDING_VERIFICATION'
        with pytest.raises(r.RepairError):r.health_apply(conn,domain,p['token'])
    publish(dsn,domain)
    with r.connection() as conn:
        s=r.health_status(conn,domain);assert s['health_status']=='DATA_HEALTH_VERIFIED' and s['violations']==0
        entry=next(e for e in r.findings_status(conn,domain) if e.get('health_status'))
        assert entry['finding']['finding_type']=='HEALTH_REVIEW'
        a=conn.execute("SELECT * FROM metadata.test_repair WHERE repair_family='HEALTH'").fetchone()
        assert a['action_type']=='SET' and a['verification_result']=='PASS' and a['before_analysis_id']
        # The policy must not reopen the customer/card or delete source entities.
        q="SELECT status FROM test_env.customer WHERE customer_id=1" if domain=='CUSTOMER_LENDING' else "SELECT status FROM test_cards.card WHERE card_id=1"
        assert conn.execute(q).fetchone()['status']=='CLOSED'


def test_health_stale_target_change_and_partial_update_rollback(repair_case,monkeypatch):
    dsn,domain=repair_case;seed_health(dsn,domain)
    with r.connection() as conn:p=r.health_preview(conn,domain)
    with pytest.raises(r.RepairError,match='Stale'):
        with r.connection() as conn:r.health_apply(conn,domain,'0'*64)
    original=r.audit
    def fail(*args,**kwargs):raise r.RepairError('forced audit failure')
    monkeypatch.setattr(r,'audit',fail)
    with pytest.raises(r.RepairError,match='forced'):
        with r.connection() as conn:r.health_apply(conn,domain,p['token'])
    with r.connection() as conn:
        assert r.live_count(conn,domain,r.model.HEALTH_RULES[domain]['predicate'])==1
        assert not conn.execute("SELECT 1 FROM metadata.test_repair WHERE repair_family='HEALTH'").fetchone()
    monkeypatch.setattr(r,'audit',original)


def test_writer_column_privileges_and_prod_updates_rejected(repair_case):
    for query in ["UPDATE prod_snapshot.account SET status='CLOSED'", "UPDATE prod_cards.card_limit SET available_limit=0", "UPDATE test_env.customer SET status='OPEN'", "UPDATE test_env.account SET currency='USD'", "UPDATE test_cards.card SET status='ACTIVE'", "UPDATE test_cards.card_limit SET total_limit=0"]:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with r.connection() as conn:conn.execute(query)


def test_health_same_count_but_changed_targets_invalidates_preview(repair_case):
    dsn,domain=repair_case;seed_health(dsn,domain)
    with r.connection() as conn:p=r.health_preview(conn,domain)
    with psycopg.connect(dsn) as conn:
        if domain=='CUSTOMER_LENDING':
            conn.execute("INSERT INTO test_env.customer VALUES (2,'RETAIL','CLOSED','STANDARD','2026-08-26')")
            conn.execute("INSERT INTO test_env.account VALUES (3,2,'CURRENT','TRY','ACTIVE',false,'2026-08-26')")
            conn.execute("UPDATE test_env.customer SET status='OPEN' WHERE customer_id=1")
        else:
            conn.execute("UPDATE test_cards.card SET status=CASE WHEN card_id=1 THEN 'ACTIVE' ELSE 'CLOSED' END")
    with r.connection() as conn:
        assert r.health_preview(conn,domain)['violations']==1
        with pytest.raises(r.RepairError,match='Stale'):r.health_apply(conn,domain,p['token'])


def test_population_plan_content_change_invalidates_token(repair_case,monkeypatch):
    from dataclasses import replace
    _,domain=repair_case
    with r.connection() as conn:r.save(conn,domain,2);p=r.preview(conn,domain)
    original=r.model.population_plan
    monkeypatch.setattr(r.model,'population_plan',lambda *args,**kwargs:replace(original(*args,**kwargs),version=2))
    with r.connection() as conn:
        with pytest.raises(r.RepairError,match='Stale'):r.apply(conn,domain,p['token'])
        assert r.live_count(conn,domain)==1
