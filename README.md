# Test Reality — narrow working POC

A database-derived comparison of synthetic production-reference and test environments. The complete slice is PostgreSQL → fingerprints → business-state coverage → findings → persisted Spring API → React dashboard. There is no LLM, repair action, authentication, or Oracle integration.

## Project

| Directory | Responsibility |
|---|---|
| `backend/` | Java 21, Spring Boot 3.5.14, Maven; orchestration and persisted API |
| `analysis/` | Python 3.12, FastAPI, psycopg, Polars; SQL aggregates and deterministic findings |
| `frontend/` | React, TypeScript, Vite; real API data and finding evidence |
| `infra/` | Isolated Compose, schema initialization, environment creation, verification |
| `demo-data/` | Fixed-seed, bounded-batch generator; 120,000 customers per environment |
| `docs/` | Architecture, calculations, and five-minute demo |

## Local run

Prerequisites: Docker Desktop/Engine with Compose, Java 21, Maven, Node 22+ with npm, and Python 3 for orchestration scripts. Python application code runs in the Python 3.12 image.

```sh
sh infra/run-local.sh
```

This creates a random project-only password in ignored `infra/.env`, runs backend tests, builds assets/images, runs real PostgreSQL analysis tests, seeds the demo transactionally, starts the four services, runs analysis, and verifies API values against independent SQL queries. It stops immediately if a command fails.

- Dashboard: http://127.0.0.1:18080
- Backend: http://127.0.0.1:18081
- Backend health: http://127.0.0.1:18081/actuator/health
- PostgreSQL and analysis have no published ports.

The generator refuses to append to existing source data or replace a dataset with different parameters. Repeating it with the same recorded seed/version/customer count is a no-op. It intentionally generates a 45-day timestamp gap, fewer multi-account customers, absent feature combinations, and closed TEST customers with active accounts. All displayed measurements are calculated afterward from SQL; none are seeded dashboard values.

## API

| Method | Endpoint | Result |
|---|---|---|
| POST | `/api/analysis/run` | Calculate, persist, and return a complete snapshot |
| GET | `/api/overview` | Latest successful overview, dataset provenance, latest attempt status |
| GET | `/api/findings` | Latest successful run's findings |
| GET | `/api/findings/{id}` | Persisted structured evidence for a finding |
| GET | `/api/states/coverage` | Significant reference states and TEST counts/prevalences |
| GET | `/api/fingerprints` | Table, column, business, relationship, freshness metrics |

Before the first successful run, result endpoints return 409 with an explicit message. Concurrent runs return 409. Failed runs are recorded and return an error; previous successful results remain available with the failed-attempt status shown. Finding detail returns 404 for unknown IDs.

## Tests

```sh
mvn -f backend/pom.xml test
docker compose --env-file infra/.env -f infra/compose.yml run --rm analysis sh -c 'TEST_DATABASE_URL="$DATABASE_URL" python -m pytest -q -p no:cacheprovider tests'
python3 infra/smoke.py
cd frontend
node node_modules/@playwright/test/cli.js test
```

Python tests create uniquely named, project-owned test databases and remove only those databases afterward. They do not modify the demo schemas. Browser tests use installed Google Chrome by default, query the running API, and exercise desktop evidence navigation and a mobile viewport. Set `PW_CHANNEL=chromium` to use a Playwright-managed Chromium installation instead.

## Remote deployment and access

The authorized target is `root@167.172.168.122`, exclusively under `/opt/test-reality-poc`. Compose project/network/volume names begin with `test-reality-poc`. Existing Binance-bot files, images, networks, services, and data remain preserved.

Runtime memory caps: PostgreSQL 384 MiB, analysis 384 MiB, backend 640 MiB, frontend 64 MiB; total **1.44 GiB**. CPU caps total **0.95 vCPU**. Images and Java/React artifacts are built on the Mac; deployment loads project images on the droplet. No on-droplet Maven/npm compilation is needed. Remote secrets are generated independently in mode-0600 `infra/.env`.

Access the droplet's loopback listeners with a tunnel. If the local stack is already running on 18080/18081, use these distinct local ports:

```sh
/usr/bin/ssh -o UseKeychain=yes -o ExitOnForwardFailure=yes -N \
  -L 28080:127.0.0.1:18080 -L 28081:127.0.0.1:18081 root@167.172.168.122
```

Then open http://127.0.0.1:28080 for the remote dashboard or http://127.0.0.1:28081/actuator/health for the remote backend. No public HTTP listener or firewall change is required.

Inspect only this project:

```sh
cd /opt/test-reality-poc
docker compose --env-file infra/.env -f infra/compose.yml ps
docker compose --env-file infra/.env -f infra/compose.yml logs --tail=50 backend analysis
python3 infra/smoke.py
```

Keep at least 10 GiB free disk. Use bounded uploads and single-job analysis; this POC has no unbounded data ingestion. Logs are limited to 2 × 5 MiB per service. Monitor the project's volume and image growth; memory caps do not impose storage quotas. Co-hosting shares a kernel and Docker daemon. Reassess capacity before restarting trading workloads or increasing data/model scope.

See [architecture](docs/ARCHITECTURE.md), [fingerprint definitions](docs/FINGERPRINT.md), [demo flow](docs/DEMO_FLOW.md), and [validation report](docs/VALIDATION.md).
