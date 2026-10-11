-- Additive migration: source data and existing result JSON are never rewritten.
CREATE SCHEMA IF NOT EXISTS prod_cards;
CREATE SCHEMA IF NOT EXISTS test_cards;
DO $$ DECLARE s text; BEGIN
 FOREACH s IN ARRAY ARRAY['prod_cards','test_cards'] LOOP
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.card_customer(customer_id bigint PRIMARY KEY)',s);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.funding_account(account_id bigint PRIMARY KEY, customer_id bigint NOT NULL REFERENCES %I.card_customer)',s,s);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.card(card_id bigint PRIMARY KEY, customer_id bigint NOT NULL REFERENCES %I.card_customer, card_type text NOT NULL, status text NOT NULL, physical_virtual text NOT NULL, created_at timestamptz NOT NULL)',s,s);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.card_account(card_id bigint NOT NULL REFERENCES %I.card, account_id bigint NOT NULL REFERENCES %I.funding_account, relationship_type text NOT NULL, PRIMARY KEY(card_id,account_id))',s,s,s);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.card_limit(card_id bigint PRIMARY KEY REFERENCES %I.card, total_limit numeric(14,2) NOT NULL, available_limit numeric(14,2) NOT NULL, effective_at timestamptz NOT NULL)',s,s);
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.card_status_history(history_id bigint PRIMARY KEY, card_id bigint NOT NULL REFERENCES %I.card, status text NOT NULL, changed_at timestamptz NOT NULL)',s,s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS card_customer_idx ON %I.card(customer_id)',s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS card_history_idx ON %I.card_status_history(card_id)',s);
 END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS metadata.cards_dataset(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), seed integer NOT NULL, entities_per_environment integer NOT NULL, reference_timestamp timestamptz NOT NULL, generator_version text NOT NULL);
ALTER TABLE metadata.analysis_run ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'CUSTOMER_LENDING' CHECK(domain IN ('CUSTOMER_LENDING','CARDS'));
CREATE INDEX IF NOT EXISTS analysis_domain_completed_idx ON metadata.analysis_run(domain,completed_at DESC) WHERE status='SUCCEEDED';
