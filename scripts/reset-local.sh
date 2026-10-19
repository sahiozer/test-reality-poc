#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --yes ]; } || fail 'Usage: ./scripts/reset-local.sh [--yes]'
printf '%s\n' 'WARNING: this permanently deletes only test-reality-local PostgreSQL/demo results and local Ollama models.' 'Other Compose projects, images and volumes are not removed.'
if [ "${1:-}" != --yes ]; then
  [ -t 0 ] || fail 'Confirmation required. Run interactively, or explicitly pass --yes.'
  printf '%s' 'Type RESET to delete this local project data: '
  read -r answer
  [ "$answer" = RESET ] || fail 'Cancelled; nothing deleted.'
fi
dc --profile ai down --volumes --timeout 30
printf '%s\n' 'Local project data deleted. To recreate: ./scripts/start-local.sh && ./scripts/init-local.sh'
