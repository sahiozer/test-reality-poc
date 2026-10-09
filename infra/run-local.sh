#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 infra/create-env.py
mvn -f backend/pom.xml -B -ntp package
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
docker compose --env-file infra/.env -f infra/compose.yml build
docker compose --env-file infra/.env -f infra/compose.yml up -d --wait postgres analysis
docker compose --env-file infra/.env -f infra/compose.yml run --rm analysis sh -c 'TEST_DATABASE_URL="$DATABASE_URL" python -m pytest -q -p no:cacheprovider tests'
docker compose --env-file infra/.env -f infra/compose.yml run --rm analysis python demo_data/generate.py
docker compose --env-file infra/.env -f infra/compose.yml up -d --wait
python3 - <<'PY'
import json,urllib.request
r=urllib.request.Request('http://127.0.0.1:18081/api/analysis/run',method='POST')
with urllib.request.urlopen(r,timeout=190) as response:
    result=json.load(response)
print('Analysis complete:',result['run_id'])
PY
python3 infra/smoke.py
