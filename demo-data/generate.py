"""Bounded COPY batches; deterministic rows, no source-data reads or resets."""
import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import random

import psycopg
from psycopg import sql

SEED = 20261010
CUSTOMERS = 120_000
REFERENCE = datetime(2026, 10, 10, tzinfo=timezone.utc)
VERSION = "1"
SCHEMAS = ("prod_snapshot", "test_env")


def customer_bundle(customer_id, environment, rng):
    is_test = environment == "test_env"
    kind = "CORPORATE" if rng.random() < 0.20 else "RETAIL"
    draw = rng.random()
    active_accounts = (2 + int(rng.random() < 0.30)) if draw < (0.075 if is_test else 0.325) else (0 if draw > 0.85 else 1)
    fx = rng.random() < 0.28
    active_loan = rng.random() < 0.30
    active_card = rng.random() < 0.60
    blocked = rng.random() < 0.08
    # Remove combinations, not findings or dashboard numbers.
    if is_test:
        if kind == "RETAIL" and active_accounts >= 2:
            fx = False
            active_loan = False
        if kind == "CORPORATE" and active_accounts >= 2:
            active_card = False
        if blocked:
            active_card = False
    closed = active_accounts == 0 and rng.random() < 0.35
    if is_test and active_accounts > 0 and rng.random() < 0.02:
        closed = True
    cutoff = REFERENCE - timedelta(days=45 if is_test else 0)
    customer_date = cutoff - timedelta(days=rng.randint(0, 730))
    customer = (customer_id, kind, "CLOSED" if closed else "OPEN",
                None if rng.random() < 0.025 else rng.choice(["STANDARD", "PREMIUM", "SME"]), customer_date)
    accounts = []
    for index in range(active_accounts + 1):
        active = index < active_accounts
        accounts.append((customer_id * 10 + index, customer_id,
                         "CURRENT" if active else "SAVINGS", "USD" if fx and index == 0 else "TRY",
                         "ACTIVE" if active else "CLOSED", blocked and index == 0,
                         customer_date + timedelta(days=rng.randint(0, (cutoff - customer_date).days))))
    loans = [(customer_id, customer_id, "BUSINESS" if kind == "CORPORATE" else "PERSONAL",
              "ACTIVE" if active_loan else "CLOSED",
              Decimal(rng.randint(1_000, 5_000_000)) / 100 if active_loan else Decimal(0),
              active_loan and rng.random() < 0.08)]
    cards = [(customer_id, customer_id, "BUSINESS" if kind == "CORPORATE" else "DEBIT",
              "ACTIVE" if active_card else "CLOSED")]
    return {"customer": [customer], "account": accounts, "loan": loans, "card": cards}


def generate(dsn, customers=CUSTOMERS, seed=SEED):
    if not 1 <= customers <= 200_000:
        raise ValueError("customers must be between 1 and 200000")
    with psycopg.connect(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(20261010)")
        existing = conn.execute("SELECT seed, customers_per_environment, generator_version FROM metadata.demo_dataset").fetchone()
        if existing:
            if existing != (seed, customers, VERSION):
                raise ValueError("Existing dataset differs; refusing to replace data")
            return {"status": "already_seeded", "seed": seed, "customers_per_environment": customers}
        for schema in SCHEMAS:
            for table in ("customer", "account", "loan", "card"):
                if conn.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM {}.{})").format(sql.Identifier(schema), sql.Identifier(table))).fetchone()[0]:
                    raise ValueError("Demo schema already contains data; refusing to append")
            rng = random.Random(seed + (1 if schema == "test_env" else 0))
            for start in range(1, customers + 1, 2_000):
                batch = {t: [] for t in ("customer", "account", "loan", "card")}
                for cid in range(start, min(start + 2_000, customers + 1)):
                    for table, rows in customer_bundle(cid, schema, rng).items():
                        batch[table].extend(rows)
                for table, rows in batch.items():
                    with conn.cursor().copy(sql.SQL("COPY {}.{} FROM STDIN").format(sql.Identifier(schema), sql.Identifier(table))) as copy:
                        for row in rows:
                            copy.write_row(row)
            for table in ("customer", "account", "loan", "card"):
                conn.execute(sql.SQL("ANALYZE {}.{}").format(sql.Identifier(schema), sql.Identifier(table)))
        conn.execute("INSERT INTO metadata.demo_dataset(singleton, seed, customers_per_environment, reference_timestamp, generator_version) VALUES (true,%s,%s,%s,%s)",
                     (seed, customers, REFERENCE, VERSION))
    return {"status": "seeded", "seed": seed, "customers_per_environment": customers}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--customers", type=int, default=CUSTOMERS)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    print(generate(os.environ["DATABASE_URL"], args.customers, args.seed))
