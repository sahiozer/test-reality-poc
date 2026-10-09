"""Aggregate source rows in PostgreSQL; Polars handles only bounded grouped states."""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json

import polars as pl
from psycopg import sql
from psycopg.rows import dict_row

SCHEMAS = ("prod_snapshot", "test_env")
TABLES = {
    "customer": ["customer_id", "customer_type", "status", "segment", "created_at"],
    "account": ["account_id", "customer_id", "account_type", "currency", "status", "blocked_flag", "opened_at"],
    "loan": ["loan_id", "customer_id", "loan_type", "status", "outstanding_amount", "delinquency_flag"],
    "card": ["card_id", "customer_id", "card_type", "status"],
}
DATES = {"customer": "created_at", "account": "opened_at"}
FEATURES = ["customer_type", "account_count_bucket", "has_fx_account", "has_active_loan", "has_active_card", "has_blocked_account"]
MIN_SUPPORT = 100
MIN_PREVALENCE = 0.001
UNDERREPRESENTATION_RATIO = 0.5


def serial(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def metric(name, env, value, scope, timestamp, method):
    return {"metric_name": name, "environment": env, "value": serial(value),
            "scope": scope, "timestamp": timestamp, "calculation_method": method}


def table_fingerprints(conn, env, timestamp):
    metrics = []
    latest = None
    for table, columns in TABLES.items():
        expressions = [sql.SQL("COUNT(*) AS row_count")]
        for col in columns:
            expressions += [sql.SQL("COUNT({}) AS {}").format(sql.Identifier(col), sql.Identifier("nonnull_" + col)),
                            sql.SQL("COUNT(DISTINCT {}) AS {}").format(sql.Identifier(col), sql.Identifier("distinct_" + col))]
        if table in DATES:
            date = sql.Identifier(DATES[table])
            expressions += [sql.SQL("MIN({}) AS min_date").format(date), sql.SQL("MAX({}) AS max_date").format(date)]
        query = sql.SQL("SELECT {} FROM {}.{}").format(sql.SQL(", ").join(expressions), sql.Identifier(env), sql.Identifier(table))
        with conn.cursor(row_factory=dict_row) as cur:
            row = cur.execute(query).fetchone()
        count = row["row_count"]
        metrics.append(metric("row_count", env, count, table, timestamp, "PostgreSQL COUNT(*)"))
        for col in columns:
            scope = table + "." + col
            metrics.append(metric("null_rate", env, (count - row["nonnull_" + col]) / count if count else None,
                                  scope, timestamp, "(COUNT(*) - COUNT(column)) / COUNT(*); null for empty table"))
            metrics.append(metric("distinct_count", env, row["distinct_" + col], scope, timestamp, "PostgreSQL COUNT(DISTINCT column), excluding null"))
        if table in DATES:
            for key in ("min_date", "max_date"):
                metrics.append(metric(key, env, row[key], table + "." + DATES[table], timestamp, "PostgreSQL " + ("MIN" if key == "min_date" else "MAX")))
            if row["max_date"] and (latest is None or row["max_date"] > latest):
                latest = row["max_date"]
    return metrics, latest


def grouped_features(conn, env):
    # Identifiers can only originate in our schema allowlist.
    if env not in SCHEMAS:
        raise ValueError("Unknown environment")
    query = f"""
    WITH a AS (
      SELECT customer_id, COUNT(*) FILTER (WHERE status='ACTIVE') AS active_accounts,
             BOOL_OR(currency <> 'TRY') AS fx, BOOL_OR(blocked_flag) AS blocked
      FROM {env}.account GROUP BY customer_id
    ), l AS (
      SELECT customer_id, BOOL_OR(status='ACTIVE') AS active_loan FROM {env}.loan GROUP BY customer_id
    ), k AS (
      SELECT customer_id, BOOL_OR(status='ACTIVE') AS active_card FROM {env}.card GROUP BY customer_id
    ), features AS (
      SELECT c.customer_type, c.status AS customer_status,
        CASE WHEN COALESCE(a.active_accounts,0)=0 THEN '0'
             WHEN a.active_accounts=1 THEN '1' ELSE '2+' END AS account_count_bucket,
        COALESCE(a.fx,false) AS has_fx_account,
        COALESCE(l.active_loan,false) AS has_active_loan,
        COALESCE(k.active_card,false) AS has_active_card,
        COALESCE(a.blocked,false) AS has_blocked_account
      FROM {env}.customer c
      LEFT JOIN a USING(customer_id) LEFT JOIN l USING(customer_id) LEFT JOIN k USING(customer_id)
    )
    SELECT customer_type, customer_status, account_count_bucket, has_fx_account,
      has_active_loan, has_active_card, has_blocked_account, COUNT(*) AS count
    FROM features GROUP BY 1,2,3,4,5,6,7
    """
    with conn.cursor(row_factory=dict_row) as cur:
        return cur.execute(query).fetchall()


def business_metrics(rows):
    total = sum(r["count"] for r in rows)
    count = lambda predicate: sum(r["count"] for r in rows if predicate(r))
    counts = {
        "customers_0_active_accounts": count(lambda r: r["account_count_bucket"] == "0"),
        "customers_1_active_account": count(lambda r: r["account_count_bucket"] == "1"),
        "customers_2plus_active_accounts": count(lambda r: r["account_count_bucket"] == "2+"),
        "customers_with_fx_accounts": count(lambda r: r["has_fx_account"]),
        "customers_with_active_loans": count(lambda r: r["has_active_loan"]),
        "customers_with_active_cards": count(lambda r: r["has_active_card"]),
        "closed_customers_with_active_accounts": count(lambda r: r["customer_status"] == "CLOSED" and r["account_count_bucket"] != "0"),
    }
    return {"customer_count": total, **counts,
            "multi_account_rate": counts["customers_2plus_active_accounts"] / total if total else None}


def aggregate_states(rows):
    if not rows:
        return []
    return pl.DataFrame(rows).group_by(FEATURES).agg(pl.col("count").sum()).sort(FEATURES).to_dicts()


def state_id(features):
    return hashlib.sha256(json.dumps(features, sort_keys=True).encode()).hexdigest()[:16]


def coverage(prod_rows, test_rows, min_support=MIN_SUPPORT, min_prevalence=MIN_PREVALENCE):
    prod_total = sum(r["count"] for r in prod_rows)
    test_total = sum(r["count"] for r in test_rows)
    test_states = {tuple(r[f] for f in FEATURES): r["count"] for r in aggregate_states(test_rows)}
    states = []
    for row in aggregate_states(prod_rows):
        prod_count = row["count"]
        prevalence = prod_count / prod_total if prod_total else 0
        if prod_count < min_support or prevalence < min_prevalence:
            continue
        features = {f: row[f] for f in FEATURES}
        test_count = test_states.get(tuple(row[f] for f in FEATURES), 0)
        test_prevalence = test_count / test_total if test_total else 0
        assessment = "MISSING" if test_count == 0 else ("UNDERREPRESENTED" if test_prevalence < prevalence * UNDERREPRESENTATION_RATIO else "REPRESENTED")
        states.append({"state_id": state_id(features), "features": features, "prod_count": prod_count,
                       "prod_prevalence": prevalence, "test_count": test_count, "test_prevalence": test_prevalence,
                       "represented_in_test": test_count > 0, "assessment": assessment})
    return {"total_significant_prod_states": len(states), "represented_in_test": sum(s["test_count"] > 0 for s in states),
            "missing_in_test": sum(s["assessment"] == "MISSING" for s in states),
            "underrepresented_in_test": sum(s["assessment"] == "UNDERREPRESENTED" for s in states),
            "thresholds": {"minimum_support": min_support, "minimum_prevalence": min_prevalence,
                           "underrepresentation_prevalence_ratio": UNDERREPRESENTATION_RATIO},
            "states": states}


def findings(run_id, prod, test, states, freshness, timestamp):
    output = []
    def add(kind, title, prod_value, test_value, severity, evidence, explanation):
        stable_key = evidence.get("state_id", evidence.get("metric", kind))
        output.append({"finding_id": f"{run_id}:{kind}:{stable_key}", "finding_type": kind,
                       "title": title, "evidence": evidence, "prod_value": prod_value, "test_value": test_value,
                       "severity": severity, "assessment": explanation, "explanation": explanation,
                       "explanation_ready": {"rule": kind, "evidence": evidence, "prod_value": prod_value, "test_value": test_value},
                       "generated_at": timestamp})
    prod_rate, test_rate = prod["multi_account_rate"], test["multi_account_rate"]
    if prod_rate is not None and test_rate is not None and prod_rate - test_rate >= 0.05:
        add("REPRESENTATION_GAP", "Customers with two or more active accounts", prod_rate, test_rate, "HIGH",
            {"metric": "multi_account_rate", "unit": "fraction", "prod_count": prod["customers_2plus_active_accounts"],
             "test_count": test["customers_2plus_active_accounts"], "prod_total": prod["customer_count"], "test_total": test["customer_count"],
             "gap_percentage_points": (prod_rate - test_rate) * 100,
             "calculation_method": "customers with >=2 ACTIVE accounts / all customers", "threshold_percentage_points": 5},
            f"TEST trails PROD by {(prod_rate - test_rate) * 100:.2f} percentage points.")
    for state in states["states"]:
        if state["assessment"] == "MISSING":
            add("MISSING_STATE", describe_state(state["features"]), state["prod_count"], state["test_count"], "HIGH",
                {**state, "unit": "customers", "thresholds": states["thresholds"],
                 "calculation_method": "exact six-feature state match after per-customer relational aggregation"},
                f"This state occurs for {state['prod_count']:,} PROD customers and no TEST customers.")
        elif state["assessment"] == "UNDERREPRESENTED":
            add("REPRESENTATION_GAP", describe_state(state["features"]), state["prod_prevalence"], state["test_prevalence"], "MEDIUM",
                {**state, "unit": "fraction", "thresholds": states["thresholds"],
                 "calculation_method": "state customers / all environment customers; TEST prevalence < 50% of PROD"},
                "TEST prevalence is below half of the PROD reference prevalence.")
    if test["closed_customers_with_active_accounts"] > 0:
        add("DATA_HEALTH_ISSUE", "Closed customers with active accounts", prod["closed_customers_with_active_accounts"],
            test["closed_customers_with_active_accounts"], "HIGH",
            {"metric": "closed_customers_with_active_accounts", "unit": "customers",
             "calculation_method": "COUNT customers WHERE customer.status=CLOSED AND at least one account.status=ACTIVE"},
            "TEST contains closed customers whose accounts remain active.")
    if freshness["age_difference_days"] is not None and freshness["age_difference_days"] > 7:
        add("FRESHNESS_GAP", "TEST business timestamps lag behind PROD", freshness["prod_latest"], freshness["test_latest"], "MEDIUM",
            {**freshness, "unit": "timestamp", "threshold_days": 7,
             "calculation_method": "MAX(customer.created_at, account.opened_at) per environment; PROD max minus TEST max"},
            f"TEST's latest business timestamp is {freshness['age_difference_days']:.1f} days behind PROD.")
    return output


def describe_state(f):
    parts = [f["customer_type"].title(), f"{f['account_count_bucket']} active accounts"]
    for key, yes, no in [("has_fx_account", "FX account", "no FX"), ("has_active_loan", "active loan", "no active loan"),
                         ("has_active_card", "active card", "no active card"), ("has_blocked_account", "blocked account", "no blocked account")]:
        parts.append(yes if f[key] else no)
    return " · ".join(parts)


def analyze(conn, run_id, now=None):
    now = now or datetime.now(timezone.utc)
    timestamp = now.isoformat()
    metrics, business, groups, latest = [], {}, {}, {}
    conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
    conn.execute("SET LOCAL statement_timeout = '90s'")
    conn.execute("SET LOCAL work_mem = '16MB'")
    with conn.cursor(row_factory=dict_row) as cur:
        dataset = cur.execute("SELECT seed, customers_per_environment, reference_timestamp, generator_version FROM metadata.demo_dataset WHERE singleton=true").fetchone()
    if not dataset:
        raise ValueError("Demo data has not been seeded")
    for env in SCHEMAS:
        table_metrics, latest[env] = table_fingerprints(conn, env, timestamp)
        metrics.extend(table_metrics)
        groups[env] = grouped_features(conn, env)
        business[env] = business_metrics(groups[env])
        for key, value in business[env].items():
            metrics.append(metric(key, env, value, "customer relationships", timestamp,
                                  "PostgreSQL grouped per-customer features; sums of bounded groups"))
        for table in ("account", "loan", "card"):
            query = sql.SQL("SELECT COUNT(*) FROM {}.{} r LEFT JOIN {}.customer c USING(customer_id) WHERE c.customer_id IS NULL").format(
                sql.Identifier(env), sql.Identifier(table), sql.Identifier(env))
            count = conn.execute(query).fetchone()[0]
            metrics.append(metric("orphan_" + table + "s", env, count, "relationship health", timestamp, "PostgreSQL LEFT JOIN; missing customer PK"))
        metrics.append(metric("latest_business_timestamp", env, latest[env], "freshness", timestamp, "MAX across customer.created_at and account.opened_at"))
    states = coverage(groups[SCHEMAS[0]], groups[SCHEMAS[1]])
    prod_latest, test_latest = latest[SCHEMAS[0]], latest[SCHEMAS[1]]
    freshness = {"prod_latest": serial(prod_latest), "test_latest": serial(test_latest),
                 "age_difference_days": (prod_latest - test_latest).total_seconds() / 86400 if prod_latest and test_latest else None,
                 "test_age_days": (now - test_latest).total_seconds() / 86400 if test_latest else None}
    result_findings = findings(run_id, business[SCHEMAS[0]], business[SCHEMAS[1]], states, freshness, timestamp)
    overview = {"reality_gaps": sum(f["finding_type"] == "REPRESENTATION_GAP" for f in result_findings),
                "data_health_issues": sum(f["finding_type"] == "DATA_HEALTH_ISSUE" for f in result_findings),
                "missing_data_states": states["missing_in_test"], "test_data_age_days": freshness["test_age_days"],
                "business_metrics": business, "freshness": freshness, "environments": list(SCHEMAS)}
    return {"run_id": run_id, "generated_at": timestamp, "dataset": {k: serial(v) for k, v in dataset.items()},
            "overview": overview, "fingerprints": metrics, "coverage": states, "findings": result_findings}
