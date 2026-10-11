import importlib.util
import random
from pathlib import Path
from datetime import datetime, timezone
import psycopg
from psycopg import sql
import pytest
from app.engine import analyze
from app.cards import SCHEMAS, FEATURES

path=Path('/app/demo_data/generate_cards.py')
if not path.exists():path=Path(__file__).resolve().parents[2]/'demo-data/generate_cards.py'
spec=importlib.util.spec_from_file_location('cards_generator',path);gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)

@pytest.fixture(scope='module')
def result(database_dsn):
    gen.generate(database_dsn,10000)
    with psycopg.connect(database_dsn) as conn:
        return analyze(conn,'cards-validation',datetime(2026,10,10,tzinfo=timezone.utc),domain='CARDS')

def test_seed_determinism_and_no_mixed_test_entities():
    def rows(seed,env):
        rng=random.Random(seed)
        return [gen.bundle(i,env,rng) for i in range(1,101)]
    assert rows(gen.SEED,'prod_cards')==rows(gen.SEED,'prod_cards')
    assert rows(gen.SEED,'prod_cards')!=rows(gen.SEED+1,'prod_cards')
    assert all(len({c[4] for c in b['card']})==1 for b in rows(gen.SEED,'test_cards'))

def test_calculations_match_sql_and_no_join_fanout(result,database_dsn):
    with psycopg.connect(database_dsn) as conn:
        for env in SCHEMAS:
            b=result['overview']['business_metrics'][env]
            assert b['entity_count']==10000
            assert b['card_count']==conn.execute(sql.SQL('SELECT COUNT(*) FROM {}.card').format(sql.Identifier(env))).fetchone()[0]
            assert b['closed_cards_with_available_limit']==conn.execute(sql.SQL("SELECT COUNT(*) FROM {}.card c JOIN {}.card_limit l USING(card_id) WHERE status='CLOSED' AND available_limit>0").format(sql.Identifier(env),sql.Identifier(env))).fetchone()[0]
            assert b['active_cards']+b['closed_cards']+b['blocked_cards']==b['card_count']
            assert b['physical_cards']+b['virtual_cards']==b['card_count']
            assert b['debit_cards']+b['credit_cards']==b['card_count']
            assert all(m['value']==0 for m in result['fingerprints'] if m['environment']==env and m['scope']=='relationship health')

def test_generic_findings_and_explicit_rule(result):
    fs=result['findings'];assert {f['finding_type'] for f in fs}=={'REPRESENTATION_GAP','MISSING_STATE','DATA_HEALTH_ISSUE','FRESHNESS_GAP'}
    health=next(f for f in fs if f['finding_type']=='DATA_HEALTH_ISSUE')
    assert health['prod_value']==0 and health['test_value']>0
    assert health['evidence']['ruleId']=='BR-CARD-001'
    assert health['evidence']['ruleSource']=='configured_business_rule'
    assert any(f['evidence'].get('features',{}).get('has_physical_and_virtual') for f in fs if f['finding_type']=='MISSING_STATE')
    gap=next(f for f in fs if f['evidence'].get('metric')=='multi_active_card_rate')
    assert gap['prod_value']-gap['test_value']>=0.05
    assert all(f['domain']=='CARDS' for f in fs)

def test_freshness_and_bounded_coverage(result):
    assert result['overview']['freshness']['age_difference_days']==30
    c=result['coverage'];assert c['missing_in_test']>0
    assert c['represented_in_test']+c['missing_in_test']==c['total_significant_prod_states']
    assert c['underrepresented_in_test']<=c['represented_in_test']
    assert all(set(s['features'])==set(FEATURES) for s in c['states'])
    assert all(s['prod_count']>=100 and s['prod_prevalence']>=0.001 for s in c['states'])
    assert all(s['assessment']=='MISSING' for s in c['states'] if s['features']['has_physical_and_virtual'])

def test_insert_once_and_fk(result,database_dsn):
    assert gen.generate(database_dsn,10000)['status']=='already_seeded'
    with pytest.raises(ValueError,match='refusing'):gen.generate(database_dsn,10000,1)
    with psycopg.connect(database_dsn) as conn:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):conn.execute("INSERT INTO test_cards.card_limit VALUES(-1,100,100,now())")
    with psycopg.connect(database_dsn) as conn:
        assert conn.execute('SELECT COUNT(*) FROM test_cards.card_customer').fetchone()[0]==10000


def test_unknown_domain_rejected(database_dsn):
    with psycopg.connect(database_dsn) as conn:
        with pytest.raises(ValueError,match='Unknown domain'):analyze(conn,'unknown',domain='UNKNOWN')
