"""Local packaging checks; never imported by the product or used on the droplet."""
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def http(path, method="GET"):
    with urlopen(Request("http://backend:8080" + path, method=method), timeout=190) as response:
        return json.load(response)


def migrate():
    # init.sql is a fresh-volume initializer, NOT safe to replay on a populated DB.
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
        base = ["metadata.demo_dataset", "metadata.analysis_run", "metadata.finding"]
        base += [f"{schema}.{table}" for schema in ("prod_snapshot", "test_env")
                 for table in ("customer", "account", "loan", "card")]
        for table in base:
            check(conn.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0],
                  f"Missing base table {table}. Inspect PostgreSQL initialization logs; do not replay init.sql over existing data.")
        conn.execute("SELECT pg_advisory_xact_lock(20261012)")
        conn.execute(Path("/app/cards.sql").read_text())
    print("Existing infra/cards.sql applied transactionally (idempotent, additive).")
    print("Explanation table/recovery is managed by the existing backend startup SQL; no new migration framework.")


def initialize():
    for domain in ("CUSTOMER_LENDING", "CARDS"):
        suffix = "" if domain == "CUSTOMER_LENDING" else "?domain=CARDS"
        try:
            http("/api/overview" + suffix)
            print(f"{domain}: keeping existing saved analysis (Run analysis in the UI to refresh).")
        except HTTPError as error:
            if error.code != 409:
                raise
            result = http("/api/analysis/run" + suffix, "POST")
            print(f"{domain}: first analysis saved: {len(result['fingerprints'])} fingerprints, {len(result['findings'])} findings.")


def verify(services_only=False):
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
        check(conn.execute("SELECT 1").fetchone() == (1,), "Database connectivity failed")
        for schema in ("prod_snapshot", "test_env", "prod_cards", "test_cards", "metadata"):
            check(conn.execute("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=%s)", (schema,)).fetchone()[0],
                  f"Missing schema {schema}; run init-local.sh --migrate-only")
    check(http("/actuator/health")["status"] == "UP", "Backend actuator is not UP")
    with urlopen("http://127.0.0.1:8000/health", timeout=5) as response:
        check(json.load(response)["status"] == "UP", "Analysis health is not UP")
    with urlopen("http://frontend:8080/", timeout=5) as response:
        check(b'id="root"' in response.read(), "Frontend HTML is not reachable")
    domains = http("/api/domains")
    check({d["id"] for d in domains} == {"CUSTOMER_LENDING", "CARDS"}, "Both workspaces must be available")
    print("Database, backend actuator, analysis, frontend and both workspaces: PASS")
    if services_only:
        print("Services-only check: saved-result checks skipped. Run init-local.sh before the full verification.")
        return
    cases = [
        ("CUSTOMER_LENDING", 130, 31, 44, 70, 26, 2, 2023, 45, "multi_account_rate", 0.32469166666666666, 0.07510833333333333),
        ("CARDS", 164, 61, 58, 110, 52, 6, 872, 30, "multi_active_card_rate", 0.2035875, 0.0221625),
    ]
    for domain, nfp, nf, represented, total, missing, under, health, gap, rate_key, prod_rate, test_rate in cases:
        suffix = "" if domain == "CUSTOMER_LENDING" else "?domain=CARDS"
        try:
            overview = http("/api/overview" + suffix)
        except HTTPError as error:
            if error.code == 409:
                raise RuntimeError(f"{domain} has no saved analysis. Run ./scripts/init-local.sh first.") from None
            raise
        fingerprints = http("/api/fingerprints" + suffix)
        findings = http("/api/findings" + suffix)
        coverage = http("/api/states/coverage" + suffix)
        check((len(fingerprints), len(findings)) == (nfp, nf), f"{domain}: fingerprint/finding baseline drift")
        actual_coverage = tuple(coverage[k] for k in ("represented_in_test", "total_significant_prod_states", "missing_in_test", "underrepresented_in_test"))
        check(actual_coverage == (represented, total, missing, under), f"{domain}: coverage baseline drift")
        issue = next(f for f in findings if f["finding_type"] == "DATA_HEALTH_ISSUE")
        check((issue["prod_value"], issue["test_value"]) == (0, health), f"{domain}: health baseline drift")
        check(overview["freshness"]["age_difference_days"] == gap, f"{domain}: freshness gap drift")
        prod, test = overview["environments"]
        for env, expected in ((prod, prod_rate), (test, test_rate)):
            check(math.isclose(overview["business_metrics"][env][rate_key], expected, abs_tol=1e-12), f"{domain}: {env} rate drift")
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5) as conn:
            if domain == "CUSTOMER_LENDING":
                # Identifiers below are fixed allowlisted schemas, never user input.
                for schema in ("prod_snapshot", "test_env"):
                    check(conn.execute(f"SELECT COUNT(*) FROM {schema}.customer").fetchone()[0] == 120000, f"{schema}: expected 120000 customers")
                sql_health = conn.execute("SELECT COUNT(*) FROM test_env.customer c WHERE status='CLOSED' AND EXISTS(SELECT 1 FROM test_env.account a WHERE a.customer_id=c.customer_id AND a.status='ACTIVE')").fetchone()[0]
            else:
                for schema, rows in (("prod_cards", 105640), ("test_cards", 82789)):
                    check(conn.execute(f"SELECT COUNT(*) FROM {schema}.card_customer").fetchone()[0] == 80000, f"{schema}: expected 80000 card customers")
                    check(conn.execute(f"SELECT COUNT(*) FROM {schema}.card").fetchone()[0] == rows, f"{schema}: card row-count drift")
                sql_health = conn.execute("SELECT COUNT(*) FROM test_cards.card c JOIN test_cards.card_limit l USING(card_id) WHERE c.status='CLOSED' AND l.available_limit>0").fetchone()[0]
            check(sql_health == health, f"{domain}: SQL health count does not match baseline")
        measured = datetime.fromisoformat(overview["generated_at"])
        latest = datetime.fromisoformat(overview["freshness"]["test_latest"])
        check(math.isclose(overview["test_data_age_days"], (measured-latest).total_seconds()/86400, abs_tol=1e-6), f"{domain}: TEST age calculation mismatch")
        print(f"{domain}: PASS — {nfp} fingerprints; {nf} findings; {represented}/{total} coverage; {missing} missing; {under} underrepresented; {health:,} health; {gap}-day gap; {prod_rate:.2%}/{test_rate:.2%}.")
        print(f"  TEST age at saved analysis: {overview['test_data_age_days']:.2f} days (time-dependent; not the freshness gap).")


if __name__ == "__main__":
    try:
        command = sys.argv[1]
        if command == "migrate":
            migrate()
        elif command == "initialize":
            initialize()
        elif command == "verify":
            verify("--services-only" in sys.argv[2:])
        else:
            raise RuntimeError("Unknown local setup command")
    except (RuntimeError, HTTPError, URLError, psycopg.Error, KeyError, StopIteration, ValueError) as error:
        # Never dump connection strings, environment variables, or query parameters.
        print(f"Local setup failed: {type(error).__name__}: " + (str(error) if not isinstance(error, psycopg.Error) else "database operation failed; inspect local PostgreSQL logs"), file=sys.stderr)
        sys.exit(1)
