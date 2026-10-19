#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --services-only ]; } || fail 'Usage: ./scripts/verify-local.sh [--services-only]'
healthy postgres analysis backend frontend
if [ -n "$(dc --profile ai ps -q ollama)" ]; then healthy ollama; fi
dc exec -T analysis python /opt/local-tools/manage.py verify "${1:-}"
printf '%s\n' 'Local verification passed. Dashboard:'
dc port frontend 8080
