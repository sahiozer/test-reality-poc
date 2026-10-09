import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
import pytest


@pytest.fixture(scope="session")
def database_dsn():
    admin_dsn = os.environ.get("TEST_DATABASE_URL")
    if not admin_dsn:
        pytest.fail("TEST_DATABASE_URL is required: integration tests must use real PostgreSQL")
    database = "test_reality_checks_" + uuid4().hex[:12]
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
    dsn = make_conninfo(admin_dsn, dbname=database)
    init = Path("/app/init.sql")
    if not init.exists():
        init = Path(__file__).resolve().parents[2] / "infra" / "init.sql"
    with psycopg.connect(dsn) as conn:
        conn.execute(init.read_text())
    yield dsn
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))


@pytest.fixture(scope="session")
def sample_dsn(database_dsn):
    with psycopg.connect(database_dsn) as conn:
        for schema in ("prod_snapshot", "test_env"):
            test = schema == "test_env"
            cutoff = "2026-08-26T00:00:00Z" if test else "2026-10-10T00:00:00Z"
            for cid in range(1, 401):
                closed = test and cid <= 10
                conn.execute(sql.SQL("INSERT INTO {}.customer VALUES (%s,'RETAIL',%s,%s,%s)").format(sql.Identifier(schema)),
                             (cid, "CLOSED" if closed else "OPEN", None if cid <= 40 else "STANDARD", cutoff))
                active = 2 if cid <= (20 if test else 200) else (1 if cid <= 300 else 0)
                for index in range(active):
                    conn.execute(sql.SQL("INSERT INTO {}.account VALUES (%s,%s,'CURRENT',%s,'ACTIVE',%s,%s)").format(sql.Identifier(schema)),
                                 (cid * 10 + index, cid, "USD" if not test and cid <= 100 else "TRY", not test and cid <= 100, cutoff))
                if cid <= (20 if test else 100):
                    conn.execute(sql.SQL("INSERT INTO {}.loan VALUES (%s,%s,'PERSONAL','ACTIVE',100,false)").format(sql.Identifier(schema)), (cid, cid))
                if cid <= (20 if test else 200):
                    conn.execute(sql.SQL("INSERT INTO {}.card VALUES (%s,%s,'DEBIT','ACTIVE')").format(sql.Identifier(schema)), (cid, cid))
        conn.execute("INSERT INTO metadata.demo_dataset(seed,customers_per_environment,reference_timestamp,generator_version) VALUES (1,400,'2026-10-10','test-fixture')")
    return database_dsn
