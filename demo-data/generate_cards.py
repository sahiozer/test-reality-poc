"""Independent deterministic Cards dataset, insert-once with bounded COPY batches."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import random
from pathlib import Path
import psycopg
from psycopg import sql

SEED = 20261012
ENTITIES = 80000
REFERENCE = datetime(2026,10,10,tzinfo=timezone.utc)
VERSION = 'cards-1'
SCHEMAS = ('prod_cards','test_cards')
TABLES = ('card_customer','funding_account','card','card_account','card_limit','card_status_history')

def bundle(cid, environment, rng):
    test = environment == 'test_cards'
    cutoff = REFERENCE - timedelta(days=30 if test else 0)
    physical = 'PHYSICAL' if rng.random()<0.75 else 'VIRTUAL'
    cards = 2 if rng.random()<(0.035 if test else 0.32) else 1
    out = {t:[] for t in TABLES}
    out['card_customer']=[(cid,)]
    out['funding_account']=[(cid,cid)]
    for index in range(cards):
        card_id=cid*10+index
        form = ('VIRTUAL' if physical=='PHYSICAL' else 'PHYSICAL') if not test and index==1 and rng.random()<0.75 else physical
        status=rng.choices(['ACTIVE','CLOSED','BLOCKED'],weights=[80,15,5])[0]
        created=cutoff-timedelta(days=rng.randint(30,365))
        changed=cutoff-timedelta(days=0 if cid==1 else rng.randint(0,30))
        limit=Decimal(rng.choice([10000,25000,100000]))
        available=Decimal(rng.randint(0,int(limit))) if status=='ACTIVE' else Decimal(0)
        if test and status=='CLOSED' and rng.random()<0.07: available=Decimal(rng.randint(1,5000))
        out['card'].append((card_id,cid,rng.choice(['DEBIT','CREDIT']),status,form,created))
        out['card_account'].append((card_id,cid,'PRIMARY'))
        out['card_limit'].append((card_id,limit,available,changed))
        out['card_status_history'].extend([(card_id*10,card_id,'ISSUED',created),(card_id*10+1,card_id,status,changed)])
    return out

def generate(dsn, entities=ENTITIES, seed=SEED):
    if not 1<=entities<=100000: raise ValueError('entities must be 1..100000')
    migration=Path(__file__).resolve().parents[1]/'infra/cards.sql'
    if not migration.exists(): migration=Path('/app/cards.sql')
    with psycopg.connect(dsn) as conn:
        conn.execute(migration.read_text())
        conn.execute('SELECT pg_advisory_xact_lock(20261012)')
        existing=conn.execute('SELECT seed,entities_per_environment,generator_version FROM metadata.cards_dataset').fetchone()
        if existing:
            if existing!=(seed,entities,VERSION):raise ValueError('Existing Cards dataset differs; refusing replacement')
            return {'status':'already_seeded'}
        for schema in SCHEMAS:
            for table in TABLES:
                if conn.execute(sql.SQL('SELECT EXISTS(SELECT 1 FROM {}.{})').format(sql.Identifier(schema),sql.Identifier(table))).fetchone()[0]:raise ValueError('Cards schema not empty; refusing append')
            rng=random.Random(seed+(1 if schema=='test_cards' else 0))
            for start in range(1,entities+1,2000):
                batch={t:[] for t in TABLES}
                for cid in range(start,min(start+2000,entities+1)):
                    for table,rows in bundle(cid,schema,rng).items():batch[table].extend(rows)
                for table,rows in batch.items():
                    with conn.cursor().copy(sql.SQL('COPY {}.{} FROM STDIN').format(sql.Identifier(schema),sql.Identifier(table))) as copy:
                        for row in rows:copy.write_row(row)
            for table in TABLES:conn.execute(sql.SQL('ANALYZE {}.{}').format(sql.Identifier(schema),sql.Identifier(table)))
        conn.execute('INSERT INTO metadata.cards_dataset(seed,entities_per_environment,reference_timestamp,generator_version) VALUES(%s,%s,%s,%s)',(seed,entities,REFERENCE,VERSION))
    return {'status':'seeded','entities_per_environment':entities,'seed':seed}

if __name__=='__main__':print(generate(os.environ['DATABASE_URL']))
