# Sourced by helpers; no host Python, Node, Java or jq required.
set -eu
TR_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TR_PROJECT=test-reality-local
fail() { printf '%s\n' "Error: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail 'Install Docker Desktop or Docker Engine with Compose first.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
docker info >/dev/null 2>&1 || fail 'Docker is not running/reachable. Start Docker Desktop or your Docker Engine.'
[ -f "$TR_ROOT/.env" ] || fail 'Missing .env. From the repository root run: cp .env.example .env'
# Explicit project/file arguments isolate every helper, including destructive reset.
dc() { docker compose --project-name "$TR_PROJECT" --project-directory "$TR_ROOT" --env-file "$TR_ROOT/.env" -f "$TR_ROOT/compose.yml" "$@"; }
dc config --quiet || fail 'Invalid local configuration; check .env and compose.yml.'
healthy() {
  for service in "$@"; do
    container=$(dc ps -q "$service")
    [ -n "$container" ] || fail "$service is not running. Run ./scripts/start-local.sh first."
    state=$(docker inspect --format '{{.State.Health.Status}}' "$container")
    [ "$state" = healthy ] || fail "$service is $state; inspect: docker compose logs --tail=60 $service"
    printf '%s\n' "$service: healthy"
  done
}
