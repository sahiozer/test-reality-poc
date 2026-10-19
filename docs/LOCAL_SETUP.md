# Test Reality — Local Setup

**Fastest path** — Git and Docker are all you need. Builds, database setup and
demo generation run in containers. No droplet, cloud account or existing demo
access is required.

```sh
git clone <PRIVATE_REPO_URL>
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
validated**; WSL2 with Docker integration may work but is not a tested target.
The clean-install validation used macOS Apple Silicon / Docker Desktop with Linux
ARM64 containers. A native Linux Engine host has not been separately tested;
the configuration uses portable Compose features and POSIX shell helpers.

## 2. Clone

Use the URL supplied by the repository owner, for example:

```sh
git clone git@github.com:<ORG>/<PRIVATE_REPO>.git test-reality-poc
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
No machine-specific path or remote host is needed.

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

There is **no Flyway/Liquibase framework**. No product SQL migration was changed
for this setup. `init.sql` is a first-volume initializer, **not** an upgrade script;
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
Open the selector and explore Overview, Findings, State coverage, Fingerprints
and Fingerprint Pipeline. Workspace selection survives refresh.

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

## 16. Architecture summary

PostgreSQL source schemas → Python SQL aggregation / shared deterministic engine
→ persisted Spring Boot API → React dashboard. Finding explanations add local
BM25 RAG context and optionally async CPU Ollama. LLM does not calculate metrics,
coverage or findings. Source generators and SQL migrations are unchanged.

## 17. Security note

Use synthetic/demo data only. No production credentials, cloud keys, private
keys, tunnel tokens or demo PINs belong in this checkout. Listeners are loopback
only and the internal services have no published ports. Builds/downloads need
outbound internet; the local application does not depend on the existing droplet
or external inference services. This setup adds no public gateway, authentication
service, Cloudflare tunnel or firewall rule. It never modifies Binance resources.
