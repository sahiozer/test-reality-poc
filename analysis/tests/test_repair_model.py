"""Pure semantic/planner tests: no per-finding materializer or display-text input."""
from dataclasses import replace
import json
import pytest
from app import repair_model as m


@pytest.mark.parametrize('domain',['CUSTOMER_LENDING','CARDS'])
def test_canonical_plan_is_immutable_deterministic_parameterized_test_only(domain):
    p=m.population_plan(domain,'arbitrary-metric-key',m.named_predicate(domain),3)
    assert p==m.population_plan(domain,'arbitrary-metric-key',m.named_predicate(domain),3)
    assert p.digest()==m.population_plan(domain,'arbitrary-metric-key',m.named_predicate(domain),3).digest()
    assert p.digest()!=replace(p,qualifying_entities_needed=4).digest()
    with pytest.raises(Exception):p.rows=()
    for statement in m.statements(p):
        assert 'INSERT INTO '+m.SCHEMAS[domain][1]+'.' in statement
        assert '%(v0)s' in statement and 'prod_' not in statement
    with pytest.raises(m.RepairError):m.statements(replace(p,domain='prod_snapshot'))
    with pytest.raises(m.RepairError):m.statements(replace(p,rows=(m.Row('prod_snapshot.customer',(1,)),)))


def test_feature_satisfaction_minimal_rows_and_absence():
    pred=m.predicate('CUSTOMER_LENDING',[m.condition('customer_type','EQ','CORPORATE'),m.condition('active_account_count','GTE',2),m.condition('fx_account_count','EQ',0),m.condition('active_loan_count','EQ',0),m.condition('active_card_count','GTE',1),m.condition('blocked_account_count','GTE',1)])
    p=m.population_plan('CUSTOMER_LENDING','arbitrary',pred,8)
    assert p.physical_rows()=={'customer':8,'account':16,'card':8}
    accounts=[r for r in p.rows if r.table=='account']
    assert all(r.values[3]=='TRY' and r.values[4]=='ACTIVE' for r in accounts)
    assert sum(r.values[5] for r in accounts)==1
    assert p.rows[0].values[1]=='CORPORATE'
    # An absent active account does not forbid CLOSED FX/blocked accounts.
    p=m.population_plan('CUSTOMER_LENDING','absence',m.state_predicate('CUSTOMER_LENDING',{'account_count_bucket':'0','has_fx_account':True,'has_blocked_account':True}),1)
    assert len(p.rows)==2 and p.rows[1].values[4]=='CLOSED'


@pytest.mark.parametrize('conditions',[
 [m.condition('active_account_count','EQ',-1)],
 [m.condition('active_account_count','EQ',True)],
 [m.condition('active_account_count','EQ',0),m.condition('active_account_count','GTE',1)],
 [m.condition('active_account_count','GT',32)],
 [m.condition('customer_type','EQ','malicious SQL')],
 [m.condition('unknown_feature','EQ',1)],
 [m.condition('active_account_count','DROP',1)]])
def test_invalid_unsupported_and_conflicting_predicates(conditions):
    pred=m.predicate('CUSTOMER_LENDING',conditions)
    cap,reason=m.capability('CUSTOMER_LENDING','arbitrary',pred)
    assert cap=='POPULATION_REPAIR_UNSUPPORTED' and reason
    with pytest.raises(m.RepairError):m.count_query('CUSTOMER_LENDING',pred)


def test_range_constraints_choose_minimal_integer():
    p=m.population_plan('CUSTOMER_LENDING','ranges',m.predicate('CUSTOMER_LENDING',[m.condition('active_account_count','GT',2),m.condition('active_account_count','LT',5)]),1)
    assert p.physical_rows()['account']==3


@pytest.mark.parametrize('domain,conditions',[
 ('CUSTOMER_LENDING',[m.condition('customer_status','EQ','CLOSED'),m.condition('active_account_count','GTE',1)]),
 ('CARDS',[m.condition('card_status','EQ','CLOSED'),m.condition('has_available_limit','EQ',True)])])
def test_population_refuses_to_introduce_known_health_violation(domain,conditions):
    cap,reason=m.capability(domain,'arbitrary',m.predicate(domain,conditions))
    assert cap=='POPULATION_REPAIR_UNSUPPORTED' and 'Policy conflict' in reason


def test_synthetic_binding_is_unique_fk_valid_and_does_not_advance_time():
    from datetime import datetime,timezone,timedelta
    t=datetime(2026,9,10,tzinfo=timezone.utc)
    p=m.population_plan('CARDS','state:any',m.state_predicate('CARDS',{'card_type':'DEBIT','card_status':'BLOCKED','active_card_count_bucket':'2+','has_recent_status_change':False,'has_physical_and_virtual':True}),1)
    cards=[m.bindings(r,-1000,t) for r in p.rows if r.table=='card']
    assert len(cards)==3 and len({r['v0'] for r in cards})==3
    assert all(r['v1']==-1000 for r in cards)
    history=[m.bindings(r,-1000,t) for r in p.rows if r.table=='card_status_history']
    assert all(r['v3']==t-timedelta(days=8) for r in history)
    assert not set(r['v0'] for r in history)&set(r['v0'] for r in cards)


def test_health_requires_exact_approved_policy_and_bound_sql():
    from copy import deepcopy
    for domain,rule in m.HEALTH_RULES.items():
        assert m.health_statement(domain,rule).startswith('UPDATE '+m.SCHEMAS[domain][1]+'.')
        assert '%s' in m.health_statement(domain,rule)
        no_policy=deepcopy(rule);no_policy['policy']=None
        with pytest.raises(m.RepairError,match='policy'):m.health_targets(domain,no_policy)
        arbitrary=deepcopy(rule);arbitrary['policy']['value']='OPEN'
        with pytest.raises(m.RepairError,match='policy'):m.health_statement(domain,arbitrary)


def test_partial_card_predicate_cannot_overproduce_support_cards():
    pred=m.predicate('CARDS',[m.condition('active_card_count','GTE',2),m.condition('has_available_limit','EQ',False)])
    cap,reason=m.capability('CARDS','partial',pred)
    assert cap=='POPULATION_REPAIR_UNSUPPORTED' and 'isolate' in reason


def test_sql_condition_parameters_cannot_become_identifiers():
    pred=m.predicate('CUSTOMER_LENDING',[m.condition('customer_type','EQ','CORPORATE')])
    query,params=m.count_query('CUSTOMER_LENDING',pred)
    assert 'CORPORATE' not in query and params==('CORPORATE',)
    malicious=m.predicate('CUSTOMER_LENDING',[m.condition('customer_type; DELETE FROM test_env.customer','EQ','CORPORATE')])
    with pytest.raises(m.RepairError):m.count_query('CUSTOMER_LENDING',malicious)
