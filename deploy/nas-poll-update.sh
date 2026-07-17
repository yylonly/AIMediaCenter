#!/usr/bin/env sh
# NAS-side auto-update poller for AIMediaCenter.
#
# Queries the GHCR registry for the current digest of the `latest` tag and
# redeploys via `docker compose` when it changes. Public images are queryable
# anonymously, so no token/credentials are needed on the NAS.
#
# Install (DSM): Control Panel -> Task Scheduler -> Create -> Scheduled Task ->
# User-defined script, run as root every 5 minutes:
#   bash /volume1/docker/aimediacenter/nas-poll-update.sh
#
# Install (generic crontab):
#   */5 * * * * /volume1/docker/aimediacenter/nas-poll-update.sh >> /volume1/docker/aimediacenter/poll.log 2>&1

set -eu

DEPLOY_DIR="/volume1/docker/aimediacenter"
IMAGE="yylonly/aimediacenter"   # GHCR repo path (without registry prefix)
TAG="latest"
DIGEST_FILE="${DEPLOY_DIR}/.last-digest"
REGISTRY="ghcr.io"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

# 1. Fetch an anonymous bearer token for the GHCR registry.
token_response=$(curl -fsSL "https://${REGISTRY}/token?scope=repository:${IMAGE}:pull" 2>/dev/null) || {
  log "ERROR: failed to fetch registry token"; exit 1
}
token=$(printf '%s' "$token_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -z "$token" ] && token=$(printf '%s' "$token_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$token" ]; then
  log "ERROR: could not parse registry token"; exit 1
fi

# 2. Ask the registry for the manifest digest of the tag (Accept header
#    requests a manifest list so multi-arch images return a stable top digest).
new_digest=$(curl -fsSL \
  -H "Authorization: Bearer ${token}" \
  -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
  -o /dev/null -D - \
  "https://${REGISTRY}/v2/${IMAGE}/manifests/${TAG}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2; exit}')

if [ -z "$new_digest" ]; then
  log "ERROR: could not read digest for ${IMAGE}:${TAG}"; exit 1
fi

# 3. Compare with the last known digest.
old_digest=""
[ -f "$DIGEST_FILE" ] && old_digest=$(cat "$DIGEST_FILE" 2>/dev/null || true)

if [ "$new_digest" = "$old_digest" ]; then
  exit 0
fi

log "Digest changed: '${old_digest:-<none>}' -> '${new_digest}'. Redeploying..."

# 4. Pull the new image and recreate the container.
cd "$DEPLOY_DIR"
if ! docker compose pull; then
  log "ERROR: docker compose pull failed"; exit 1
fi
if ! docker compose up -d --remove-orphans; then
  log "ERROR: docker compose up failed"; exit 1
fi

# 5. Persist the new digest and prune dangling images.
printf '%s\n' "$new_digest" > "$DIGEST_FILE"
docker image prune -f >/dev/null 2>&1 || true
log "Update complete. Now tracking digest '${new_digest}'."
