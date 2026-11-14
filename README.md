# Test Reality — narrow working POC

**POC STATUS: COMPLETE / PASS — technically frozen for executive demo.** See the [completion seal](docs/POC_COMPLETION.md).

A database-derived comparison of synthetic production-reference and test environments. The complete slice is PostgreSQL → fingerprints → business-state coverage → findings → persisted Spring API → React dashboard. The droplet also has an optional local Ollama Turkish explanation layer; analysis remains deterministic. There is no repair action, authentication, or Oracle integration. See [LLM integration](docs/LLM_INTEGRATION.md) for the original deployment setup and fallback, or [Local Setup](docs/LOCAL_SETUP.md) for optional local AI.

## Project

| Directory | Responsibility |
|---|---|
| `backend/` | Java 21, Spring Boot 3.5.14, Maven; orchestration and persisted API |
| `analysis/` | Python 3.12, FastAPI, psycopg, Polars; SQL aggregates and deterministic findings |
| `frontend/` | React, TypeScript, Vite; real API data and finding evidence |
| `infra/` | Isolated Compose, schema initialization, environment creation, verification |
| `demo-data/` | Fixed-seed, bounded-batch generators for Customer & Lending and Cards |
| `docs/` | Architecture, calculations, and five-minute demo |

## Local run

**New machine? Start with [Local Setup](docs/LOCAL_SETUP.md).** Only Git and Docker
with Compose are required; Java, Node and Python builds run inside Docker.

```sh
cp .env.example .env
./scripts/start-local.sh
./scripts/init-local.sh
```

Open http://localhost:18080. Both Customer & Lending and Cards are seeded and
analyzed locally. Ollama is optional; core mode uses deterministic fallback.
The root `compose.yml` owns the separate `test-reality-local` project and volumes.
It does not use the droplet, its credentials, tunnel or PIN.

The existing `infra/compose*.yml` and `infra/run-local.sh` are the legacy
host-toolchain/deployment path. They are retained for the existing deployment;
do not mix their `test-reality-poc` volumes or `infra/.env` with the new local setup.

## API

| Method | Endpoint | Result |
|---|---|---|
| POST | `/api/analysis/run` | Calculate, persist, and return a complete snapshot |
| GET | `/api/overview` | Latest successful overview, dataset provenance, latest attempt status |
| GET | `/api/findings` | Latest successful run's findings |
| GET | `/api/findings/{id}` | Persisted evidence, deterministic summary, lazy explanation/status |
| GET | `/api/states/coverage` | Significant reference states and TEST counts/prevalences |
| GET | `/api/fingerprints` | Table, column, business, relationship, freshness metrics |

Before the first successful run, result endpoints return 409 with an explicit message. Concurrent runs return 409. Failed runs are recorded and return an error; previous successful results remain available with the failed-attempt status shown. Finding detail returns 404 for unknown IDs.

## Tests

The existing engineering commands below target the legacy `infra/` stack. For the
root local stack use `./scripts/verify-local.sh` as described in [Local Setup](docs/LOCAL_SETUP.md).

```sh
mvn -f backend/pom.xml test
docker compose --env-file infra/.env -f infra/compose.yml run --rm analysis sh -c 'TEST_DATABASE_URL="$DATABASE_URL" python -m pytest -q -p no:cacheprovider tests'
python3 infra/smoke.py
cd frontend
node node_modules/@playwright/test/cli.js test --config playwright.config.cjs
```

Python tests create uniquely named, project-owned test databases and remove only those databases afterward. They do not modify the demo schemas. Browser tests use installed Google Chrome by default, query the running API, and exercise desktop evidence navigation and a mobile viewport. Set `PW_CHANNEL=chromium` to use a Playwright-managed Chromium installation instead.

## Remote deployment and access

The authorized target is `root@167.172.168.122`, exclusively under `/opt/test-reality-poc`. Compose project/network/volume names begin with `test-reality-poc`. Existing Binance-bot files, images, networks, services, and data remain preserved.

Runtime memory caps: PostgreSQL 384 MiB, analysis 384 MiB, backend 640 MiB, frontend 64 MiB; total **1.44 GiB**. CPU caps total **0.95 vCPU** for the base four services. The remote-only Ollama override adds 1,024 MiB and 0.50 vCPU (combined caps **2.44 GiB / 1.45 vCPU**). It adds no published port; model storage is isolated in `test-reality-poc_ollama_models`. The droplet keeps its own model volume. Workstations can opt into a separate local Ollama/model volume through the root Compose AI profile; core mode uses deterministic fallback. Images and Java/React artifacts are built on the Mac; deployment loads project images on the droplet. No on-droplet Maven/npm compilation is needed. Remote secrets are generated independently in mode-0600 `infra/.env`.

Access the droplet's loopback listeners with a tunnel. If the local stack is already running on 18080/18081, use these distinct local ports:

```sh
/usr/bin/ssh -o UseKeychain=yes -o ExitOnForwardFailure=yes -N \
  -L 28080:127.0.0.1:18080 -L 28081:127.0.0.1:18081 root@167.172.168.122
```

Then open http://127.0.0.1:28080 for the remote dashboard or http://127.0.0.1:28081/actuator/health for the remote backend. No public HTTP listener or firewall change is required.

Inspect only this project:

```sh
cd /opt/test-reality-poc
docker compose --env-file infra/.env -f infra/compose.yml -f infra/compose.ollama.yml ps
docker compose --env-file infra/.env -f infra/compose.yml logs --tail=50 backend analysis
python3 infra/smoke.py
```

Keep at least 10 GiB free disk. Use bounded uploads and single-job analysis; this POC has no unbounded data ingestion. Logs are limited to 2 × 5 MiB per service. Monitor the project's volume and image growth; memory caps do not impose storage quotas. Co-hosting shares a kernel and Docker daemon. Reassess capacity before restarting trading workloads or increasing data/model scope.

See [architecture](docs/ARCHITECTURE.md), [fingerprint definitions](docs/FINGERPRINT.md), [demo flow](docs/DEMO_FLOW.md), and [validation report](docs/VALIDATION.md).

Micro RAG supplies a tiny domain glossary and explicit demo-rule retrieval. Explanations run asynchronously with immediate evidence/context, four-second polling and PostgreSQL persistence. See [Micro RAG](docs/MICRO_RAG.md). Deterministic findings remain unchanged; ML experiments were not integrated.
