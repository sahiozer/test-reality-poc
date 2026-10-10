"""Verify real API snapshots against independent SQL counts; no mocked responses."""
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("BACKEND_URL", "http://127.0.0.1:18081")
FRONT = os.environ.get("DASHBOARD_URL", "http://127.0.0.1:18080")


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as response:
        return json.load(response)


def sql(query):
    output = subprocess.check_output(["docker", "compose", "--env-file", str(ROOT / "infra/.env"), "-f", str(ROOT / "infra/compose.yml"),
                                      "exec", "-T", "postgres", "psql", "-U", "test_reality", "-d", "test_reality", "-At", "-c", query], text=True)
    return output.strip()


assert get("/actuator/health")["status"] == "UP"
overview = get("/api/overview")
findings = get("/api/findings")
coverage = get("/api/states/coverage")
fingerprints = get("/api/fingerprints")
# Regression expectations belong only in validation; product values come from SQL.
expected_business = {
    "prod_snapshot": {"customer_count": 120000, "customers_2plus_active_accounts": 38963, "closed_customers_with_active_accounts": 0},
    "test_env": {"customer_count": 120000, "customers_2plus_active_accounts": 9013, "closed_customers_with_active_accounts": 2023},
}
expected_accounts = {"prod_snapshot": 272523, "test_env": 233715}
for env in ("prod_snapshot", "test_env"):
    counts = json.loads(sql(f"""SELECT json_build_object(
      'customer_count',(SELECT COUNT(*) FROM {env}.customer),
      'customers_2plus_active_accounts',(SELECT COUNT(*) FROM (SELECT customer_id FROM {env}.account WHERE status='ACTIVE' GROUP BY customer_id HAVING COUNT(*)>=2) x),
      'closed_customers_with_active_accounts',(SELECT COUNT(*) FROM {env}.customer c WHERE status='CLOSED' AND EXISTS (SELECT 1 FROM {env}.account a WHERE a.customer_id=c.customer_id AND a.status='ACTIVE'))
    )"""))
    for name, count in counts.items():
        assert overview["business_metrics"][env][name] == count, (env, name, count)
        assert count == expected_business[env][name], ("deterministic dataset changed", env, name, count)
    assert overview["business_metrics"][env]["multi_account_rate"] == counts["customers_2plus_active_accounts"] / counts["customer_count"]
    for table in ("customer", "account", "loan", "card"):
        expected = int(sql(f"SELECT COUNT(*) FROM {env}.{table}"))
        actual = next(m["value"] for m in fingerprints if m["environment"] == env and m["scope"] == table and m["metric_name"] == "row_count")
        assert actual == expected, (env, table)
        assert expected == (expected_accounts[env] if table == "account" else 120000), ("deterministic table count changed", env, table)
assert len(fingerprints) == 130
assert len(findings) == 31
assert overview["freshness"]["age_difference_days"] == 45
assert [coverage[k] for k in ("total_significant_prod_states", "represented_in_test", "missing_in_test", "underrepresented_in_test")] == [70, 44, 26, 2]
assert all(any(f["finding_type"] == kind for f in findings) for kind in ("REPRESENTATION_GAP", "MISSING_STATE", "DATA_HEALTH_ISSUE", "FRESHNESS_GAP"))
assert coverage["represented_in_test"] + coverage["missing_in_test"] == coverage["total_significant_prod_states"]
assert coverage["underrepresented_in_test"] <= coverage["represented_in_test"]
assert overview["missing_data_states"] == coverage["missing_in_test"]
assert sum(f["finding_type"] == "MISSING_STATE" for f in findings) == coverage["missing_in_test"]
assert all(m["timestamp"] == overview["generated_at"] for m in fingerprints)
assert all(f["generated_at"] == overview["generated_at"] for f in findings)
assert int(sql("SELECT COUNT(*) FROM metadata.finding WHERE run_id='" + overview["run_id"] + "'")) == len(findings)
missing = next(f for f in findings if f["finding_type"] == "MISSING_STATE")
detail = get("/api/findings/" + urllib.parse.quote(missing["finding_id"], safe=""))
assert {key:detail[key] for key in missing} == missing
assert detail['aiExplanationStatus'] in ['GENERATED','FALLBACK','PENDING']
assert detail['deterministicSummary']
assert detail["test_value"] == 0 and detail["prod_value"] > 0
try:
    get("/api/findings/does-not-exist")
    raise AssertionError("Unknown finding should return 404")
except urllib.error.HTTPError as error:
    assert error.code == 404
with urllib.request.urlopen(FRONT, timeout=10) as response:
    assert b"Test Reality" in response.read()
with urllib.request.urlopen(FRONT + "/api/overview", timeout=10) as response:
    assert json.load(response)["run_id"] == overview["run_id"]
print(json.dumps({"status": "PASSED", "run_id": overview["run_id"], "business_metrics": overview["business_metrics"],
                  "freshness": overview["freshness"], "coverage": {k:v for k,v in coverage.items() if k != "states"},
                  "findings": len(findings), "fingerprint_metrics": len(fingerprints)}, indent=2))
