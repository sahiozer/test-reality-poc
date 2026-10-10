CREATE TABLE IF NOT EXISTS metadata.finding_explanation (
  cache_key text PRIMARY KEY,
  finding_id text NOT NULL REFERENCES metadata.finding(finding_id),
  evidence_hash text NOT NULL,
  context_hash text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','GENERATED','FALLBACK')),
  explanation text,
  fallback_text text NOT NULL,
  generation_latency_ms double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One backend instance: recover jobs interrupted by a previous process exit.
UPDATE metadata.finding_explanation SET status='FALLBACK', explanation=fallback_text,
  updated_at=now() WHERE status='PENDING';
