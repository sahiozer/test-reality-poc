#!/bin/sh
. "$(dirname "$0")/local/common.sh"
[ "$#" -eq 0 ] || fail 'Usage: ./scripts/start-local.sh (AI is configured explicitly in .env)'
printf '%s\n' 'Building source inside Docker and starting only test-reality-local services…' 'Initial builds download toolchains/dependencies; allow several minutes.'
dc up -d --build --wait --wait-timeout 240
printf '%s\n' 'Stack is healthy. Next: ./scripts/init-local.sh'
print_urls
