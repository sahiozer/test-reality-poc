#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --migrate-only ]; } || fail 'Usage: ./scripts/init-local.sh [--migrate-only]'
healthy postgres analysis
printf '%s\n' 'Checking base schema and applying the existing additive Cards migration…'
dc exec -T analysis python /opt/local-tools/manage.py migrate
if [ "${1:-}" = --migrate-only ]; then
  printf '%s\n' 'Migrations complete; source rows and saved analysis were not rewritten.'
  exit 0
fi
printf '%s\n' 'Seeding deterministic Customer & Lending data (120,000 customers per environment)…'
dc exec -T analysis python demo_data/generate.py
printf '%s\n' 'Seeding deterministic Cards data (80,000 customers per environment)…'
dc exec -T analysis python demo_data/generate_cards.py
healthy backend frontend
printf '%s\n' 'Creating a first analysis for each workspace only when none is saved…'
dc exec -T analysis python /opt/local-tools/manage.py initialize
"$TR_ROOT/scripts/verify-local.sh"
