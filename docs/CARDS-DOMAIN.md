# Cards domain

`/api/domains` supplies workspace presentation metadata. All existing API URLs
continue to default to `CUSTOMER_LENDING`; `?domain=CARDS` selects Cards for
analysis, overview, findings/detail, fingerprints, and coverage. Unknown domains
are rejected. Finding detail checks the persisted run's domain; workspace changes
cancel stale loads and explanation polling. The selected workspace persists locally.

The Cards adapter uses the same aggregate table fingerprints, significant-state
coverage evaluator and generic finding model/evaluator. Domain-specific SQL maps
relational data into those shared structures. Metrics come from PostgreSQL, not
frontend constants. The engine uses repeatable-read read-only snapshots.

Each of `prod_cards` and `test_cards` contains `card_customer`, `funding_account`,
`card`, `card_account`, `card_limit`, and `card_status_history`. Cards reference
local card customers; funding accounts reference local customers; the association
has a composite PK and FKs to card/account; limits have one row per card; history
has its own PK and card FK. No Customer & Lending source table is modified.

The insert-once generator uses seed 20261012 and 80,000 entities per environment,
with one or two cards per entity, bounded COPY batches, and a fixed 2026-10-10
reference. TEST has fewer multi-active-card entities, no physical/virtual
combination, positive available limits on some CLOSED cards, and a 30-day older
business timestamp. Exact cardinalities and findings are calculated, not seeded
as dashboard output. Existing datasets cannot be replaced or appended accidentally.

Eight bounded state features are card type, physical/virtual form, status, active
card count bucket, positive available limit, high-limit bucket (>=50,000), recent
status change (within seven days of that environment's latest business date),
and presence of both physical and virtual cards on the entity. Support/prevalence
and underrepresentation thresholds remain shared with the original domain.

BR-CARD-001 is the only new demo rule: “Kapalı statüdeki kartın kullanılabilir
limiti sıfır olmalıdır.” The SQL predicate is CLOSED plus available_limit > 0.
The Cards BM25 corpus reuses generic definitions and adds five required chunks:
the rule, CARD_STATUS, PHYSICAL_CARD, VIRTUAL_CARD and CARD_LIMIT. Its separate
index preserves the original 15-chunk Customer & Lending corpus, BM25 statistics,
knowledge version and existing explanation cache keys. Applicability gates prevent
cross-domain rule attachment. The model receives rule wording only as retrieved
context. Ollama model, prompt, parameters, timeout and async executor are unchanged.

Apply `infra/cards.sql` and run `demo-data/generate_cards.py` using the existing
analysis container and database before starting the updated backend. Only analysis,
backend and frontend images change. PostgreSQL and Ollama need no rebuild/restart;
existing Customer & Lending snapshots remain authoritative and preserved. Run a
Cards-only analysis to publish its first snapshot. Existing temporary demo services
and their deadline are independent of product deployments and must be preserved.
