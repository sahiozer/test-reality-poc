#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --services-only ]; } || fail 'Usage: ./scripts/verify-local.sh [--services-only]'
healthy postgres analysis backend frontend
if [ -n "$(dc --profile ai ps -q ollama)" ]; then healthy ollama; fi
dc exec -T analysis python /opt/local-tools/manage.py verify "${1:-}"
if [ "${1:-}" = --services-only ]; then
  printf '%s\n' 'Services are healthy. Next: ./scripts/init-local.sh'
else
  printf '%s\n' 'Test Reality is ready'
fi
print_urls
