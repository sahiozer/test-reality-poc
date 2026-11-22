# Test Reality — Local Setup

**Fastest path** — Git and Docker are all you need. Builds, database setup and
demo generation run in containers. No droplet, cloud account or existing demo
access is required.

```sh
git clone https://github.com/sahiozer/test-reality-poc.git
cd test-reality-poc
cp .env.example .env
./scripts/start-local.sh
./scripts/init-local.sh
```

Open **http://localhost:18080**. Select **Customer & Lending** or **Cards** in the
Banking workspace selector. Both have a saved first analysis ready to explore.

Initial image builds and seeding can take several minutes. No model is downloaded
in this default **core mode**. Before initialization finishes, the dashboard may
show “Run the first analysis”; finish `init-local.sh` before using that button.

## 1. Prerequisites

- Git and access to the private repository.
- Docker Desktop on macOS, or Docker Engine on Linux, with Docker Compose v2
  supporting `up --wait` (v2.24+; newer versions are fine).
- A running **local** Docker daemon and permission to use it. On Linux, use your
  organization's Docker access policy; the helpers do not run `sudo`.
- Core: at least 2 CPU cores, 4 GiB available Docker memory; 6 GiB is recommended
  while building. AI: allow at least 6 GiB Docker memory, preferably 8 GiB.
- At least 10 GiB free disk for images, build caches and demo data; 15 GiB is more
  comfortable for a fresh toolchain download plus optional AI.
- Internet access for initial public base images, Maven/npm/Python dependencies
  and, only if requested, the model. Once cached, analysis needs no cloud service.

No host Java, Maven, Node, npm, Python, database, Ollama, jq or browser-test tooling
is required for the quick start. Multi-stage Docker builds compile Java/React.
The shell helpers target macOS `/bin/sh` and Linux POSIX shells. Windows is **not
validated**. For Windows 11, use WSL2 with Docker Desktop's integration enabled
for that Linux distribution; run all commands inside WSL, including the clone.
Keep the checkout in the WSL Linux filesystem (for example `~/test-reality-poc`),
where Git preserves executable permissions. Do not run these `.sh` entrypoints
in native PowerShell; Git Bash has not been tested. No separate PowerShell
wrappers are required. The repository enforces LF endings for shell scripts.
This is the recommended Windows execution path, not a claim of tested Windows support.
The clean-install validation used macOS Apple Silicon / Docker Desktop with Linux
ARM64 containers. A native Linux Engine host has not been separately tested;
the configuration uses portable Compose features and POSIX shell helpers.

## 2. Clone

Clone the private repository after authenticating with your approved GitHub credential manager:

```sh
git clone https://github.com/sahiozer/test-reality-poc.git
cd test-reality-poc
```

HTTPS cloning is also supported by Git. Authenticate using your approved GitHub
credential manager/SSH setup; never put a token in a script or clone URL.

### Private GitHub access

Keep the repository private. Ask its owner to grant the collaborator/team the
least permission needed: read access is sufficient to clone and run where that
role is available. No admin access to DigitalOcean, Docker hosts or Cloudflare is
needed. Repository permissions are not changed by these instructions or helpers.
Never commit authentication credentials, private keys, `.env`, model-access
credentials or demo PINs.

## 3. Configure

```sh
cp .env.example .env
```

The checked-in example contains only a known **synthetic local-demo** password,
not a real credential. `.env` is ignored by Git and excluded from Docker build
contexts. For a different password use URL-safe hexadecimal characters, since it
is also used inside a PostgreSQL connection URL. Do not use production credentials.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_PASSWORD` | Safe local-demo value in the example | Required by PostgreSQL and the application; never commit a real password |
| `FRONTEND_PORT` | `18080` | Loopback dashboard listener |
| `BACKEND_PORT` | `18081` | Loopback backend/debug listener |
| `LLM_ENABLED` | `false` | Enable async local model generation only when explicitly configured |
| `COMPOSE_PROFILES` | empty | Set to `ai` together with `LLM_ENABLED=true` for optional Ollama |

If a port is occupied, change only the two port values in `.env` to unused ports,
for example `28080` / `28081`. Use those values in browser/curl commands below.
Internal hostnames and ports stay the same. Do not change the database password
on an existing volume and expect PostgreSQL to reset its user automatically.

The root `compose.yml` and helpers use project **`test-reality-local`**, network
`test-reality-local_backend`, volume `test-reality-local_postgres_data`, and,
when AI is enabled, `test-reality-local_ollama_models`. Do not override the Compose
project name when following this guide; helpers explicitly select this project.
It is separate from the existing `infra/compose*.yml` deployment and `infra/.env`.
No machine-specific path or remote host is needed. The macOS clean-install test
also used a restrictive `umask 077`: the analysis image normalizes read/search
permissions on packaged source while continuing to run as non-root UID 10001;
the frontend image also sets its nginx configuration to a readable file mode.
The quick start never uses an existing host `target/`, `dist/` or `node_modules/`.

## 4. Start core stack

```sh
./scripts/start-local.sh
```

Equivalent, from the repository root:

```sh
docker compose up -d --build --wait --wait-timeout 240
```

Only `postgres`, `analysis`, `backend` and `frontend` start. The first build fetches
Java/Maven, Node, Python packages and runtime images. Later starts reuse caches.
The build compiles the unchanged product; it does not run the full engineering
test suite. Runtime healthchecks and setup verification are separate below.

PostgreSQL, analysis and Ollama publish **no host ports**. Frontend/backend bind
only `127.0.0.1`. Containers use a private Compose bridge, named volumes, bounded
logs and memory/CPU limits; none use privileged mode or host networking.

## 5. Initialize / migrate DB

One command handles schema checks, the existing additive migration, deterministic
seed generation and first analyses for both workspaces:

```sh
./scripts/init-local.sh
```

The exact schema sequence on an **empty** PostgreSQL volume is:

1. The official PostgreSQL entrypoint creates database/user `test_reality`.
2. It runs the unchanged `infra/init.sql` as `001-base.sql`: `prod_snapshot`,
   `test_env`, base Customer & Lending tables and metadata/result tables.
3. It runs the unchanged `infra/cards.sql` as `002-cards.sql`: `prod_cards`,
   `test_cards`, Cards provenance and the domain column/index on analysis runs.
4. The backend's existing startup `explanations.sql` creates the explanation
   cache and recovers interrupted pending jobs to deterministic fallback.
5. `init-local.sh` checks the base tables and reapplies `cards.sql` transactionally
   and idempotently before invoking the generators.

There is **no Flyway/Liquibase framework**. The base source-schema SQL remains
unchanged. When local repair is enabled, analysis startup also applies the additive
`app/local_repair.sql` metadata migration and restricted writer grants. `init.sql`
is a first-volume initializer, **not** an upgrade script;
never replay it on populated schemas. PostgreSQL entrypoint SQL is not rerun for
an existing volume. For the current additive migration only:

```sh
./scripts/init-local.sh --migrate-only
```

## 6. Seed demo data

Seeding is already included in `init-local.sh`; do not run a second seed path.
For clarity, it uses these existing commands inside the analysis container:

```sh
docker compose exec -T analysis python demo_data/generate.py
docker compose exec -T analysis python demo_data/generate_cards.py
```

Customer & Lending uses seed `20261010`, 120,000 customers per environment and
reference time `2026-10-10T00:00:00Z`. Cards uses seed `20261012`, 80,000 card
customers per environment and the same reference time. Generators use bounded
COPY batches, transactions and insert-once provenance checks. Matching existing
seeds are no-ops; mismatches or unexpected existing rows fail instead of replacing
or appending data. Repeating `init-local.sh` keeps existing successful analyses.

## 7. Verify services

```sh
./scripts/verify-local.sh
```

This checks all four required container healthchecks, DB connectivity, all five
schemas, backend actuator, frontend HTML, analysis health, both workspace IDs,
API baseline counts/coverage/rates/gaps and independent SQL source/health counts.
Baseline drift is a failure, not silently accepted. It does not request an LLM
explanation or run a new analysis. If Ollama is running, its healthcheck is checked.

Before data/first analysis is initialized, use:

```sh
./scripts/verify-local.sh --services-only
docker compose ps
```

Optional developer browser validation uses the repository's locked test tooling
and an installed Google Chrome (host Node/npm are needed only for these tests,
not for the quick start):

```sh
cd frontend
npm ci
LOCAL_INSTALL_SMOKE=1 DASHBOARD_URL=http://127.0.0.1:18080 npx playwright test --config playwright.config.cjs
```

This opt-in test expects initialized **core mode** (`LLM_ENABLED=false`). It checks
both workspaces, all pages, evidence/context, deterministic fallback and refresh.
Use your configured frontend port if changed. Live-model tests are separately
opt-in; simulated async UI tests still run in the normal suite.

## 8. Open dashboard

- Dashboard: **http://localhost:18080**
- Backend actuator: **http://localhost:18081/actuator/health**
- API workspace descriptors: http://localhost:18081/api/domains

If `localhost` resolves only to IPv6 on your machine, use `http://127.0.0.1:18080`.
The existing stylesheet optionally requests Google Fonts; offline/blocked font
requests fall back to system fonts and do not prevent the dashboard from working.
The local dashboard has no demo PIN gateway. The remote temporary public demo
and its security/expiry configuration are not part of this local setup.

## 9. Run first analysis

`init-local.sh` saves the first result for **each** workspace when none exists.
Open the selector and explore Overview, Findings, State coverage, Fingerprints,
Fingerprint Basics and Fingerprint Pipeline. Workspace selection survives refresh.

To refresh a saved result, select the workspace and click **Run analysis**.
Equivalent explicit API commands are:

```sh
curl --fail -X POST http://localhost:18081/api/analysis/run
curl --fail -X POST 'http://localhost:18081/api/analysis/run?domain=CARDS'
```

Runs are serialized. Wait for completion before switching/running another.
Evidence is deterministic. Core-mode finding detail still retrieves local RAG
context and returns a template fallback explanation; no model is required.

## 10. Expected demo metrics

These counts and ratios are calculated from the deterministic data, not seeded
as dashboard values. Verification rejects changes to these baselines.

| Metric | Customer & Lending | Cards |
|---|---:|---:|
| Fingerprints (both environments combined) | 130 | 164 |
| Findings | 31 | 61 |
| States represented | 44 / 70 | 58 / 110 |
| Missing states | 26 | 52 |
| Underrepresented states (included in represented) | 2 | 6 |
| TEST health candidates / violations | 2,023 | 872 |
| PROD→TEST freshness gap | 45 days | 30 days |
| Multi-active account/card example: PROD | 32.47% | 20.36% |
| Multi-active account/card example: TEST | 7.51% | 2.22% |

The Cards sources contain 105,640 PROD cards / 82,789 TEST cards. The two workspaces
have separate source schemas and use the same deterministic analysis pipeline.

**Time-dependent values:** TEST data age is measured at the time of analysis
against fixed latest TEST timestamps (`2026-08-26` Customer & Lending;
`2026-09-10` Cards). A fresh run today can show a different age from the historical
demo's 46/31-day values. It is persisted with the snapshot, not a continuously
updated counter. Age, analysis timestamp, run UUID, measured latency and generated
LLM wording can differ; the source counts, rates, coverage, findings and 45/30-day
freshness gaps above must not. This difference is checked and documented explicitly.

## 11. Optional local Ollama

CPU-only inference is supported; no GPU or cloud LLM credentials are required.
The existing model remains **`qwen2.5:0.5b`** with the unchanged application prompt,
parameters and 120-second generation timeout. Its quantized model download is
approximately **398 MB** (plus the Ollama image/runtime and toolchain images).
Small or busy CPUs can take tens of seconds or exceed a minute; unavailable/slow
inference uses the existing deterministic fallback.

Edit **both** settings in `.env`:

```dotenv
LLM_ENABLED=true
COMPOSE_PROFILES=ai
```

Then explicitly enable the service and download only the current small model:

```sh
./scripts/start-local.sh
docker compose exec -T ollama ollama pull qwen2.5:0.5b
docker compose exec -T ollama ollama list
./scripts/verify-local.sh
```

The first command starts an empty Ollama server; **no model auto-download occurs**.
The explicit `ollama pull` command is the opt-in download. Then open a health
finding: evidence/context appear immediately, and the async status progresses
from PENDING to GENERATED or FALLBACK. Cached explanations return immediately.
RAG uses packaged local BM25 corpora (separate domain rules); there is no external
embedding API. Core-mode fallback and AI-mode results use separate cache keys.

For optional developer validation on a fresh AI-mode explanation cache (after the
model pull, with host Node/npm and Chrome as described above):

```sh
cd frontend
LOCAL_INSTALL_AI=1 LLM_LIVE=1 DASHBOARD_URL=http://127.0.0.1:18080 npx playwright test --config playwright.config.cjs live-explanation.spec.cjs live-rag.spec.cjs local-install-ai.spec.cjs
```

The local AI smoke test expects the first Cards health explanation to be uncached
so it can observe `PENDING`, navigate while generation runs, and check the saved
result. A previously used AI cache is not a failed installation; use a deliberate
fresh disposable local project for this qualification, not a data wipe on a
working installation.

To return to core, set `LLM_ENABLED=false`, clear `COMPOSE_PROFILES`, then:

```sh
docker compose up -d --no-deps --wait backend
docker compose --profile ai stop ollama
```

Model files remain in the local named volume until an explicit reset. These
commands do not change the remote Ollama deployment.

## 12. Stop

```sh
./scripts/stop-local.sh
```

This removes only this local project's containers/network. PostgreSQL data,
results and any model volume are retained. Start again with `start-local.sh`;
`init-local.sh` is safe to repeat and does not automatically rerun saved analyses.

## 13. Reset

**Destructive, local only:** removes this project's database, analysis results and
optional downloaded model volume. The script prints the exact scope and requires
an interactive `RESET` confirmation:

```sh
./scripts/reset-local.sh
```

For deliberate noninteractive use, `./scripts/reset-local.sh --yes` is the explicit
confirmation. It never prunes Docker, deletes images or touches another project.
To start fresh afterward:

```sh
./scripts/start-local.sh
./scripts/init-local.sh
```

## 14. Upgrade after git pull

Keep `.env` and local volumes. Read release-specific migration notes first. For
the **current** schema and additive Cards migration, from the repository root:

```sh
git pull
docker compose build
docker compose up -d --no-deps --wait analysis
./scripts/init-local.sh --migrate-only
docker compose up -d --wait --wait-timeout 240
./scripts/verify-local.sh
```

Building the new analysis image before the migration ensures its `/app/cards.sql`
is current. Compose recreates services whose image/config changed; it does not
wipe PostgreSQL. Existing successful results remain saved. Run analysis manually
if you want fresh snapshots after an upgrade. These commands do not claim to
apply unknown future migrations: future schema changes must ship reviewed SQL
and documented ordering. Do not resolve migration failures by automatically
wiping data. For meaningful local data, take a PostgreSQL dump before upgrading;
this POC's reset path is for disposable synthetic data only.

### Cold-build qualification

For an installation audit, after explicitly resetting this disposable local
project, build without reusing application build layers before the ordinary
start/init commands:

```sh
docker compose build --pull --no-cache
./scripts/start-local.sh
./scripts/init-local.sh
./scripts/verify-local.sh
```

This fetches dependencies again; it does not prune another project's images or
caches. The clean-room rerun uses a new clone and new database/model volumes,
not files copied from a prior checkout. Normal quick starts do not require the
extra cold-build command.

## 15. Troubleshooting

All commands below target the root local Compose file, not `infra/compose.yml`.
Do not paste `.env`, `docker inspect` environment output, connection URLs or
credentials into support messages.

| Symptom | Action |
|---|---|
| Docker Desktop not running | Start it, wait for the engine, then retry. On Linux check Engine access with `docker info`. |
| Port already in use | Change `FRONTEND_PORT`/`BACKEND_PORT` in `.env`, rerun start, and use the new URL. No existing container is stopped automatically. |
| Backend cannot reach PostgreSQL | `docker compose ps`; inspect `docker compose logs --tail=60 postgres backend`. Do not substitute `localhost` for the private hostname `postgres`. An edited password does not change an existing DB user. |
| Analysis unhealthy | Inspect `docker compose logs --tail=60 analysis postgres`; check Docker RAM/CPU and the DB health. Generation/init may take minutes on constrained CPUs. |
| Ollama unavailable / no model | Core/fallback remains usable. For AI set both flags, run the explicit pull command and inspect `docker compose --profile ai logs --tail=60 ollama backend`. |
| Frontend cannot reach backend | Inspect `docker compose ps` and `docker compose logs --tail=60 frontend backend`; the internal nginx target remains `backend:8080`, regardless of host port overrides. |
| API returns 409 before first run | Run `init-local.sh`; both workspaces need an initial saved result. |
| Dataset provenance mismatch | Generator refuses replacement. Use the expected defaults; reset only if you deliberately accept deleting this project's disposable data. |
| Stale volume/schema mismatch | Run the upgrade/migrate-only path. Never replay the fresh-volume initializer against populated schemas. |
| Migration fails / base tables missing | Stop initialization; inspect PostgreSQL logs and which volume/project is in use. Preserve data for investigation. For disposable failed first initialization only, explicitly reset and retry. |
| Build cannot download dependencies | Check registry/network/proxy access and disk. No prebuilt host `target/`, `dist/` or `node_modules/` should be copied into the checkout. Retry after connectivity is restored. |

### First-install network access and corporate proxies

The core first build needs the private GitHub repository, Docker Hub (including
its authentication and image/CDN endpoints), Maven Central
(`repo.maven.apache.org`), the npm registry (`registry.npmjs.org`), and PyPI
(`pypi.org` / `files.pythonhosted.org`). Optional AI additionally needs the Ollama
model registry (`registry.ollama.ai`) and its redirected blob-storage/CDN hosts.
A browser may optionally request Google Fonts; system fonts work when blocked.
There is no external embedding or inference API.

Use the organization's approved GitHub authentication and Docker Desktop/Engine
proxy and certificate configuration. Container/build traffic must be allowed too;
a working browser or host curl alone does not establish build-time access.
Do not disable TLS verification, bake proxy credentials into images, or put
credentials into clone URLs. A corporate TLS-inspection certificate may need
an organization-approved build-image trust configuration; this has not been
tested here. These external network policies cannot be solved by changing demo
metrics or by copying artifacts from another workstation.

## Local TEST demand and repair

The root local Compose stack opts into `LOCAL_TEST_REPAIR_ENABLED=true` for
backend and analysis. The legacy deployment files do not enable this feature;
its API is absent by default. No remote installation or public demo is changed.
Analysis startup applies an additive local migration in `app/local_repair.sql`
and provisions the dedicated `test_reality_repair` role. Its password comes from
`REPAIR_DATABASE_PASSWORD` (a synthetic local default in `.env.example`). The
writer can access only the allowlisted TEST tables and demand/audit metadata;
it has no PROD schema access, table-write privileges, superuser status or role
memberships. Source measurements continue through the existing read-only analysis.

QA demand is available on all compatible population/state findings. Capabilities
are explicit API fields: `demandCapability=COUNT_BASED|NONE` and
`repairCapability=AUTOMATED|NOT_AVAILABLE`. Compatibility uses typed saved count
evidence and coverage state definitions, never finding titles or an LLM.

- Missing and underrepresented states use their exact saved TEST state count
  (customers in Customer & Lending; cards in Cards).
- The two headline multi-active-account/card findings use their saved matching
  **customer** count, not the displayed percentage.
- Health violations, freshness/age and untyped percentages/technical findings
  have no count-demand workflow. They retain their existing evidence/AI behavior.

The existing `metadata.test_requirement` table is migrated in place from a domain
primary key to `(domain, metric_key)`. Existing recipe keys/requirements survive.
State keys use `state:<state_id>` and persist across run IDs; if a defined state
becomes represented and no longer generates an engine finding, its QA review row
remains visible. Engine counts/fingerprints are not inflated by QA review rows.

The two existing repair scenarios are now explicit, separately named QA rows;
no narrower scenario count is substituted for a broader headline finding:

- Customer & Lending: OPEN customer, at least two ACTIVE accounts, at least one
  account with `blocked_flag=true`. Repair adds one OPEN RETAIL customer and two
  ACTIVE TRY accounts (one blocked) per qualifying customer.
- Cards: ACTIVE CREDIT card with positive available limit, belonging to a customer
  with at least two ACTIVE cards. Each qualifying CREDIT card requires a new
  card customer, funding account, two ACTIVE PHYSICAL cards (CREDIT + DEBIT), two
  card-account links, two limits and two history records. The DEBIT companion
  supports the count bucket but is not itself a qualifying CREDIT card.

The Findings list shows a read-only QA badge and TEST/required/needed summary.
Requirement inputs stay in detail, marked **Defined by QA**. QA saves an integer
need (0–2,147,483,647), with an optional reason of up to 500 characters.
`needed = max(required - observed, 0)`; PROD never defines required demand.
Representation is shown separately from sufficiency. A matching population count
is not a certification that its data is free of health issues.

QA workflow statuses are Needs QA Review, Need Defined (awaiting fresh data),
X Needed, QA Need Met, Repair Pending Verification and Repair Verified. A finding
can remain underrepresented relative to PROD while satisfying the QA need.
Only a fresh saved analysis at the current TEST revision can verify a repair;
verification is scoped to the same domain, metric key and saved required count.

Supported state, headline and legacy predicates use the generic population planner.
Unsupported predicates retain QA demand and show their specific guided-resolution
reason; no SQL is generated for them. Preview and Apply use the same canonical
plan and parameterized statements, with a confirmation and stale
preview protection. IDs/timestamps, audit rows and the shared analysis/repair
lock are server-managed. Single operations remain capped at 100 qualifying
entities. Dates reuse TEST business time rather than advancing freshness.

**DEMO / TEST DATA LAB** remains collapsed for automated population predicates.
It removes only their owned negative-ID synthetic entities, scoped by domain and
metric key, in FK-safe transactions. An
excessive request is rejected explicitly with `Maximum removable: N`; seeded or
ordinary TEST entities and PROD references cannot be used to satisfy it.
Re-run analysis after injection. Neither demand nor repair depends on Ollama.

The existing `verify-local.sh` baseline checks are intentionally unchanged:
intentional repair changes source counts/metrics. To return to baseline, use
Inject Gap to remove the intended repair-created entities for each metric and re-run both
analyses before running baseline verification. Do not alter baseline assertions
or reset a working database simply to make the baseline checker pass.

Optional developer repair validation (host Node/npm + Chrome) must target a
disposable, independently initialized local project. Example after assigning that
project frontend port 38080:

```sh
cd frontend
LOCAL_REPAIR_SMOKE=1 DASHBOARD_URL=http://127.0.0.1:38080 npx playwright test --config playwright.config.cjs repair.spec.cjs qa-demand.spec.cjs
```

Use that disposable project's frontend port if changed. These opt-in tests add
and then remove owned synthetic entities; saved requirements/audit rows remain.
Do not run them against a working demo whose QA requirements must be preserved.
They are skipped by the ordinary baseline browser suite.

## 16. Architecture summary

PostgreSQL source schemas → Python SQL aggregation / shared deterministic engine
→ persisted Spring Boot API → React dashboard. Finding explanations add local
BM25 RAG context and optionally async CPU Ollama. LLM does not calculate metrics,
coverage or findings. Source generators and base source-schema DDL are unchanged;
local demand/repair adds its own metadata migration and restricted writer grants.

## 17. Security note

Use synthetic/demo data only. No production credentials, cloud keys, private
keys, tunnel tokens or demo PINs belong in this checkout. Listeners are loopback
only and the internal services have no published ports. Builds/downloads need
outbound internet; the local application does not depend on the existing droplet
or external inference services. This setup adds no public gateway, authentication
service, Cloudflare tunnel or firewall rule. It never modifies Binance resources.

### Generic repair extension: inspection of the existing local draft

Before extending behavior, the local draft was inspected: engine findings contain typed
`evidence.metric` or coverage `state_id`/`features`. Coverage groups six Customer &
Lending features and eight Cards features, derived from relational aggregates; state
IDs hash these feature dictionaries. QA requirements are independently persisted by
`(domain, metric_key)`. The initial automated predicates are
`open_customer_multi_active_blocked` (OPEN customer, at least two ACTIVE accounts,
any blocked account) and `active_credit_multi_card_available` (ACTIVE CREDIT card,
positive available limit, owner with at least two ACTIVE cards). Their previous
materializers inserted fixed TEST graphs, using negative sequence-derived IDs.
The dedicated `test_reality_repair` login cannot write PROD; it shares the analysis
advisory lock. An ownership ledger ties generated customer roots to repair audits.
Inject Gap removes only those owned roots and their dependent rows. Revision and
latest saved analysis checks prevent stale apply; verification requires a fresh
analysis after the write. These metric keys, persistence and safeguards are retained
while replacing fixed recipes with predicates, reusable graph builders and a renderer.
Health findings already have deterministic violation metrics, but previously had no
correction policy or write path. Freshness remains guidance only.

### Generic population and data health repairs (local opt-in)

`analysis/app/repair_model.py` owns the canonical feature registry, measurement
projections, typed state-to-predicate adapters, physical relationship graph,
immutable population plan, synthetic row builders and PostgreSQL renderer.
The engine still produces the same fingerprints and coverage states. Both original
metric keys now resolve to predicates and use the same planner as other count
findings. No display-text parsing, recipe-specific SQL or LLM mutation is used.

The planner supports the current handwritten domain feature/relationship model;
it is not an arbitrary-schema or plugin-based engine. Catalog adapters still map
headline and legacy metric names, and legacy measurement predicates retain their
compatibility definitions. The HTTP API accepts only keys from saved analysis
definitions. New canonical predicates can be exercised through engine components,
but arbitrary new predicate registration through HTTP is not implemented.

A preview binds the canonical plan, QA target, latest analysis ID, TEST timestamp
and revision into its token. Apply reconstructs this plan under the shared lock,
checks the token and live predicate count, writes bound values in FK order, checks
the exact increase and records its plan/provenance atomically. IDs use negative
sequence blocks (1000 IDs per owned root); timestamps preserve the existing TEST
cutoff. Inject Gap selects ownership by domain AND metric, removes only those
synthetic root graphs, including optional loans/cards, and checks count impact.
Old requirements, repairs and ownership remain readable after additive migration.

Health corrections are a separate family, with allowed violations zero and an
explicit local synthetic-data policy. BR-CUSTOMER-001 closes ACTIVE TEST accounts
belonging to CLOSED customers; BR-CARD-001 zeros the available limit of CLOSED
TEST cards. Preview shows affected business entities separately from physical
rows. Apply requires confirming that policy and its exact immutable target set.
The restricted role can update only `test_env.account.status` and
`test_cards.card_limit.available_limit`; it cannot reopen customers/cards or
change other columns. Health is pending until a subsequent analysis meets target.
Audits include family, key, revision, canonical plan/hash, action, entity/row
counts, before/verification analysis IDs and verification result. The resolver
records verification when reading the new saved analysis. No policy means guided
repair. Freshness offers refresh/reprovision guidance and no write controls.

Population generation refuses known health conflicts and predicates it cannot
safely satisfy or isolate to the requested number of qualifying units. QA demand
still works for unsupported population predicates, with a specific reason.
Health injection is deliberately omitted: it would require a distinct owned
invalid-graph policy. Ordinary Inject Gap never modifies seeded TEST entities.

Run destructive validation in a dedicated disposable Compose project and remove
only its volumes afterward. Do not apply the health browser tests to the user's
working database. `GENERIC_REPAIR_SMOKE=1` enables broad population browser checks;
`GENERIC_HEALTH_SMOKE=1` enables the explicitly destructive health checks, alongside
`LOCAL_REPAIR_SMOKE=1` for the original repair and QA regressions. Use a separate
`DASHBOARD_URL` and ports. Full source hashes of both PROD and working TEST schemas
should remain unchanged across this validation.

Validation of the generic repair extension (2026-11-21):

- Customer & Lending: 29/29 existing count findings plus the original local
  scenario = 30/30 generic-auto-repairable current count scenarios.
- Cards: 59/59 existing count findings plus the original local scenario = 60/60.
- Every measured definition was materialized against PostgreSQL with exact count
  checks and rollback: 72 Customer & Lending and 112 Cards definitions. No current
  population finding is demand-only; no current canonical feature is unsupported.
  This does not promise arbitrary future predicates: unknown features, contradictory
  constraints, unisolatable card units and known health conflicts are rejected with
  explicit reasons. Population operations are bounded to 100 qualifying units and
  each feature's related count to 32.
- Both health policies verified target zero in disposable fixtures: 2,023 customers
  / 2,240 account updates, and 872 cards / 872 limit updates. Their exact fixture
  values were restored before final regression. No health correction or injection
  was applied to the user's working demo.
- 69 Python tests passed; Java 34 passed / 2 existing skips; frontend build passed.
  Final browser regression: 44 passed (39 baseline + 5 existing demand/repair).
  New browser suite: 6 passed, covering six additional population lifecycles,
  both health lifecycles and unsupported/guided UI. Together with the original
  two scenarios, eight distinct population metrics completed preview/apply/rerun/
  verified/inject cycles. Existing opt-in live-LLM tests remained disabled.
- A real browser failure exposed a lost open review after Missing transitioned to
  Underrepresented. Detail selection now follows the stable metric/state key across
  new engine finding IDs. The new lifecycle tests cover that transition.
- Both complete working-demo analysis snapshots were reproduced identically with
  a frozen clock/run ID. Both PROD and both working TEST data hashes stayed equal
  to their pre-extension values, including the user's existing synthetic repairs.
- Only the local analysis/backend/frontend containers were refreshed. PostgreSQL
  and Ollama identities stayed unchanged; all five containers were healthy with
  zero restarts/OOM at the final check. The disposable project/volume was removed.
- Local validation generated ignored `.local/` evidence, including before/after
  hashes, repair audits and desktop/mobile screenshots. These runtime artifacts
  are intentionally excluded from Git; collaborators receive the source/tests
  and can create their own local evidence. This validation checkpoint made no
  deployment, SSH or remote infrastructure changes.
