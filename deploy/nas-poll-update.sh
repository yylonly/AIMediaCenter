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

# docker on Synology lives in /usr/local/bin, which SSH non-interactive
# shells and DSM Task Scheduler don't always have in PATH.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DEPLOY_DIR="/volume1/docker/aimediacenter"
IMAGE="yylonly/aimediacenter"   # GHCR repo path (without registry prefix)
TAG="latest"
DIGEST_FILE="${DEPLOY_DIR}/.last-digest"
# Registry host. In regions where ghcr.io is slow, override with a mirror,
# e.g. run as: REGISTRY=ghcr.nju.edu.cn ./nas-poll-update.sh
# (the compose file's image field must use the same host).
REGISTRY="${REGISTRY:-ghcr.io}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }

# 1. Try to fetch an anonymous bearer token. ghcr.io requires one; some
#    mirrors don't implement /token at all and allow unauthenticated pulls,
#    so a missing token is not fatal -- we just skip the Authorization header.
token_response=$(curl -fsSL "https://${REGISTRY}/token?scope=repository:${IMAGE}:pull" 2>/dev/null || true)
token=$(printf '%s' "$token_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -z "$token" ] && token=$(printf '%s' "$token_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -z "$token" ] && log "No token from ${REGISTRY}; trying unauthenticated access"

# 2. Ask the registry for the manifest digest of the tag (Accept header
#    requests a manifest list so multi-arch images return a stable top digest).
fetch_digest() {
  curl -fsSL "$@" \
    -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
    -o /dev/null -D - \
    "https://${REGISTRY}/v2/${IMAGE}/manifests/${TAG}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2; exit}'
}

if [ -n "$token" ]; then
  new_digest=$(fetch_digest -H "Authorization: Bearer ${token}" || true)
else
  new_digest=$(fetch_digest || true)
fi

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
