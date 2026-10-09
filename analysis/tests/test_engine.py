from datetime import datetime, timezone
from uuid import uuid4

import psycopg
import pytest

from app.engine import analyze, coverage, grouped_features


@pytest.fixture(scope="module")
def result(sample_dsn):
    with psycopg.connect(sample_dsn) as conn:
        return analyze(conn, str(uuid4()), datetime(2026, 10, 10, tzinfo=timezone.utc))


def metric(result, environment, scope, name):
    return next(m["value"] for m in result["fingerprints"] if m["environment"] == environment and m["scope"] == scope and m["metric_name"] == name)


def test_table_fingerprint_from_postgres(result):
    assert metric(result, "prod_snapshot", "customer", "row_count") == 400
    assert metric(result, "prod_snapshot", "account", "row_count") == 500
    assert metric(result, "test_env", "account", "row_count") == 320
    assert metric(result, "test_env", "customer.segment", "null_rate") == pytest.approx(0.1)
    assert metric(result, "prod_snapshot", "account.currency", "distinct_count") == 2
    assert metric(result, "test_env", "account.currency", "distinct_count") == 1


def test_business_fingerprint_avoids_join_fanout(result):
    prod = result["overview"]["business_metrics"]["prod_snapshot"]
    test = result["overview"]["business_metrics"]["test_env"]
    assert prod["customers_2plus_active_accounts"] == 200
    assert test["customers_2plus_active_accounts"] == 20
    assert prod["customers_0_active_accounts"] == test["customers_0_active_accounts"] == 100
    assert prod["multi_account_rate"] == 0.5
    assert test["multi_account_rate"] == 0.05


def test_exact_state_coverage(result):
    c = result["coverage"]
    assert c["total_significant_prod_states"] == 4
    assert c["represented_in_test"] == 2
    assert c["missing_in_test"] == 2
    assert c["underrepresented_in_test"] == 0
    assert all(s["prod_count"] == 100 for s in c["states"])


def test_missing_state_findings(result):
    missing = [f for f in result["findings"] if f["finding_type"] == "MISSING_STATE"]
    assert len(missing) == 2
    assert all(f["prod_value"] == 100 and f["test_value"] == 0 for f in missing)
    assert all(f["explanation_ready"]["evidence"]["state_id"] for f in missing)


def test_data_health_rule(result):
    health = [f for f in result["findings"] if f["finding_type"] == "DATA_HEALTH_ISSUE"]
    assert len(health) == 1
    assert health[0]["prod_value"] == 0
    assert health[0]["test_value"] == 10


def test_freshness_and_relationship_health(result):
    assert result["overview"]["freshness"]["age_difference_days"] == 45
    assert result["overview"]["test_data_age_days"] == 45
    for env in ("prod_snapshot", "test_env"):
        for table in ("accounts", "loans", "cards"):
            assert metric(result, env, "relationship health", "orphan_" + table) == 0


def test_support_threshold_and_empty_test(sample_dsn):
    with psycopg.connect(sample_dsn) as conn:
        prod = grouped_features(conn, "prod_snapshot")
    assert coverage(prod, [], min_support=101)["total_significant_prod_states"] == 0
    c = coverage(prod, [])
    assert c["missing_in_test"] == 4 and c["represented_in_test"] == 0


def test_underrepresentation_is_subset_of_represented():
    base = {"customer_type": "RETAIL", "customer_status": "OPEN", "account_count_bucket": "2+", "has_fx_account": False,
            "has_active_loan": False, "has_active_card": False, "has_blocked_account": False}
    prod = [{**base, "count": 200}, {**base, "account_count_bucket": "1", "count": 200}]
    test = [{**base, "count": 20}, {**base, "account_count_bucket": "1", "count": 380}]
    c = coverage(prod, test)
    assert c["total_significant_prod_states"] == c["represented_in_test"] == 2
    assert c["missing_in_test"] == 0
    assert c["underrepresented_in_test"] == 1


def test_fk_rejects_orphan(sample_dsn):
    with psycopg.connect(sample_dsn) as conn:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            conn.execute("INSERT INTO test_env.account VALUES (99999,99999,'CURRENT','TRY','ACTIVE',false,now())")
