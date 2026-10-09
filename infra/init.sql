CREATE SCHEMA prod_snapshot;
CREATE SCHEMA test_env;
CREATE SCHEMA metadata;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['prod_snapshot', 'test_env'] LOOP
    EXECUTE format('CREATE TABLE %I.customer (
      customer_id bigint PRIMARY KEY,
      customer_type text NOT NULL CHECK (customer_type IN (''RETAIL'', ''CORPORATE'')),
      status text NOT NULL CHECK (status IN (''OPEN'', ''CLOSED'')),
      segment text,
      created_at timestamptz NOT NULL
    )', s);
    EXECUTE format('CREATE TABLE %I.account (
      account_id bigint PRIMARY KEY,
      customer_id bigint NOT NULL REFERENCES %I.customer(customer_id),
      account_type text NOT NULL,
      currency text NOT NULL,
      status text NOT NULL CHECK (status IN (''ACTIVE'', ''CLOSED'')),
      blocked_flag boolean NOT NULL,
      opened_at timestamptz NOT NULL
    )', s, s);
    EXECUTE format('CREATE TABLE %I.loan (
      loan_id bigint PRIMARY KEY,
      customer_id bigint NOT NULL REFERENCES %I.customer(customer_id),
      loan_type text NOT NULL,
      status text NOT NULL CHECK (status IN (''ACTIVE'', ''CLOSED'')),
      outstanding_amount numeric(14,2) NOT NULL CHECK (outstanding_amount >= 0),
      delinquency_flag boolean NOT NULL
    )', s, s);
    EXECUTE format('CREATE TABLE %I.card (
      card_id bigint PRIMARY KEY,
      customer_id bigint NOT NULL REFERENCES %I.customer(customer_id),
      card_type text NOT NULL,
      status text NOT NULL CHECK (status IN (''ACTIVE'', ''CLOSED''))
    )', s, s);
    EXECUTE format('CREATE INDEX ON %I.account(customer_id)', s);
    EXECUTE format('CREATE INDEX ON %I.loan(customer_id)', s);
    EXECUTE format('CREATE INDEX ON %I.card(customer_id)', s);
  END LOOP;
END $$;

CREATE TABLE metadata.demo_dataset (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seed integer NOT NULL,
  customers_per_environment integer NOT NULL,
  reference_timestamp timestamptz NOT NULL,
  generator_version text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metadata.analysis_run (
  run_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  result jsonb
);
CREATE INDEX ON metadata.analysis_run(completed_at DESC) WHERE status = 'SUCCEEDED';
CREATE TABLE metadata.finding (
  finding_id text PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES metadata.analysis_run(run_id),
  finding jsonb NOT NULL
);
CREATE INDEX ON metadata.finding(run_id);
