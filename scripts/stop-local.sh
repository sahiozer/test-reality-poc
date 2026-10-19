#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || fail 'Usage: ./scripts/stop-local.sh'
printf '%s\n' 'Stopping/removing only test-reality-local containers/network; volumes and data are retained.'
dc --profile ai down --timeout 30
