CREATE TABLE IF NOT EXISTS metadata.test_requirement (
 domain text NOT NULL CHECK(domain IN ('CUSTOMER_LENDING','CARDS')),
 metric_key text NOT NULL, required_usable_count integer NOT NULL CHECK(required_usable_count>=0),
 reason text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(domain,metric_key)
);
-- Preserve the first POC's requirements while allowing independent finding keys.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='metadata.test_requirement'::regclass AND contype='p' AND array_length(conkey,1)=1) THEN
  ALTER TABLE metadata.test_requirement DROP CONSTRAINT test_requirement_pkey;
  ALTER TABLE metadata.test_requirement ADD PRIMARY KEY(domain,metric_key);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS metadata.test_revision (
 domain text PRIMARY KEY CHECK(domain IN ('CUSTOMER_LENDING','CARDS')), revision bigint NOT NULL DEFAULT 0
);
INSERT INTO metadata.test_revision(domain) VALUES ('CUSTOMER_LENDING'),('CARDS') ON CONFLICT DO NOTHING;
CREATE SEQUENCE IF NOT EXISTS metadata.test_repair_id;
CREATE TABLE IF NOT EXISTS metadata.test_repair (
 repair_id uuid PRIMARY KEY, domain text NOT NULL, metric_key text NOT NULL,
 before_count integer NOT NULL, required_count integer NOT NULL, added_count integer NOT NULL,
 revision bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS metadata.test_repair_entity (
 domain text NOT NULL, entity_id bigint NOT NULL CHECK(entity_id<0), repair_id uuid NOT NULL REFERENCES metadata.test_repair,
 PRIMARY KEY(domain,entity_id)
);
-- Additive audit upgrade; prior population audit and ownership rows are retained.
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS repair_family text NOT NULL DEFAULT 'POPULATION' CHECK(repair_family IN ('POPULATION','HEALTH'));
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS plan_hash text;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS affected_entity_count integer;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS physical_row_count integer;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS before_analysis_id uuid;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS canonical_plan jsonb;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS verification_analysis_id uuid;
ALTER TABLE metadata.test_repair ADD COLUMN IF NOT EXISTS verification_result text;
