import importlib.util
from pathlib import Path
import random

import psycopg
from psycopg import sql

path = Path('/app/demo_data/generate.py')
if not path.exists():
    path = Path(__file__).resolve().parents[2] / 'demo-data' / 'generate.py'
spec = importlib.util.spec_from_file_location('generator', path)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def bundles(seed):
    rng = random.Random(seed)
    return [generator.customer_bundle(i, 'prod_snapshot', rng) for i in range(1, 51)]


def test_fixed_seed_is_deterministic():
    assert bundles(generator.SEED) == bundles(generator.SEED)
    assert bundles(generator.SEED) != bundles(generator.SEED + 1)


def test_test_generator_excludes_intentional_missing_states():
    rng = random.Random(generator.SEED + 1)
    for cid in range(1, 5_001):
        b = generator.customer_bundle(cid, 'test_env', rng)
        kind = b['customer'][0][1]
        active = sum(a[4] == 'ACTIVE' for a in b['account'])
        fx = any(a[3] != 'TRY' for a in b['account'])
        loan = any(l[3] == 'ACTIVE' for l in b['loan'])
        card = any(c[3] == 'ACTIVE' for c in b['card'])
        blocked = any(a[5] for a in b['account'])
        assert not (kind == 'RETAIL' and active >= 2 and (fx or loan))
        assert not (kind == 'CORPORATE' and active >= 2 and card)
        assert not (blocked and card)


def test_copy_generator_persists_once_and_refuses_replacement():
    # Separate isolated DB from the hand-counted analysis fixture.
    import os
    from uuid import uuid4
    from psycopg.conninfo import make_conninfo
    import pytest
    admin_dsn = os.environ['TEST_DATABASE_URL']
    name = 'test_reality_generator_' + uuid4().hex[:12]
    dsn = make_conninfo(admin_dsn, dbname=name)
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    try:
        with psycopg.connect(dsn) as conn:
            conn.execute(Path('/app/init.sql').read_text())
        assert generator.generate(dsn, 200, 42)['status'] == 'seeded'
        assert generator.generate(dsn, 200, 42)['status'] == 'already_seeded'
        with pytest.raises(ValueError, match='refusing'):
            generator.generate(dsn, 200, 43)
        with psycopg.connect(dsn) as conn:
            assert conn.execute('SELECT COUNT(*) FROM prod_snapshot.customer').fetchone()[0] == 200
            assert conn.execute('SELECT COUNT(*) FROM test_env.customer').fetchone()[0] == 200
    finally:
        with psycopg.connect(admin_dsn, autocommit=True) as admin:
            admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))
