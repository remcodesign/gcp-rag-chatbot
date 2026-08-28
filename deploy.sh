#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh — build + push the Cloud Run container images to Artifact
# Registry, then optionally terraform plan/apply.
#
# The Cloud Run Service (`rag-api`), Job (`rag-ingest`) and the frontend
# Service (`rag-frontend`) reference these images:
#   ${REGION}-docker.pkg.dev/${PROJECT_ID}/rag/rag-api:latest
#   ${REGION}-docker.pkg.dev/${PROJECT_ID}/rag/rag-ingest:latest
#   ${REGION}-docker.pkg.dev/${PROJECT_ID}/rag/rag-frontend:latest
#
# Usage:
#   ./deploy.sh build           # build all images (no push)
#   ./deploy.sh push            # build + push all images
#   ./deploy.sh plan            # build+push, then ./tf.sh plan
#   ./deploy.sh apply           # build+push, then ./tf.sh apply (interactive)
#
# Notes:
#   - Uses a Linux/amd64 platform so the images match Cloud Run's runtime.
#   - Requires Docker Buildx (docker buildx). Falls back to plain build+load.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION="${REGION:-europe-west4}"
PROJECT_ID="${PROJECT_ID:-rag-demo-no-506313-t5}"
REPO="${REPO:-rag}"
ROOT="$SCRIPT_DIR"

IMAGE_PREFIX="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
PLATFORM="${PLATFORM:-linux/amd64}"

# Release tag: a short git commit hash (or "latest" when not in a git repo).
# Each release pins a DIFFERENT tag so `terraform apply` sees a changed image
# reference and actually redeploys the Service/Job.
#
# The tag is written to `infra/terraform.tfvars` (COMMITTED) so it is visible in
# git and read identically by both `./tf.sh` and `./deploy.sh`. Terraform-owned
# only; no env-var footgun.
image_tag() {
  local sha
  if sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"; then
    echo "$sha"
  else
    echo "latest"
  fi
}
IMAGE_TAG="${IMAGE_TAG:-$(image_tag)}"
TFVARS="$ROOT/infra/terraform.tfvars"

write_tfvars() {
  # Only ever touch the 'image_tag' line-keep any other committed values.
  if [[ -f "$TFVARS" ]] && grep -q '^image_tag' "$TFVARS"; then
    sed -i.bak "s|^image_tag.*|image_tag = \"$IMAGE_TAG\"|" "$TFVARS" && rm -f "$TFVARS.bak"
  else
    printf 'image_tag = "%s"\n' "$IMAGE_TAG" >> "$TFVARS"
  fi
  echo "Pinned image tag ${IMAGE_TAG} in ${TFVARS}"
}

build_image() {
  local dir="$1" name="$2"
  local img="${IMAGE_PREFIX}/${name}:${IMAGE_TAG}"
  echo "==> Building ${img} from ${dir}/"
  # Optional build arg for the frontend: the SSE backend origin baked into the
  # bundle (frontend + backend are separate Cloud Run Services).
  local build_args=()
  if [[ -n "${VITE_API_BASE:-}" ]]; then
    build_args+=(--build-arg "VITE_API_BASE=$VITE_API_BASE")
  fi
  # Build + push in one step so the tagged image is in Artifact Registry.
  # NOTE: `${build_args[@]+"${build_args[@]}"}` guards the EMPTY array under
  # `set -u`. On bash 3.2 (macOS default), `"${build_args[@]}"` on an empty
  # array triggers "unbound variable" and aborts the script.
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build --platform "$PLATFORM" --push \
      ${build_args[@]+"${build_args[@]}"} --tag "$img" "$ROOT/$dir"
  else
    docker build --platform "$PLATFORM" \
      ${build_args[@]+"${build_args[@]}"} --tag "$img" "$ROOT/$dir"
    docker push "$img"
  fi
  echo "$img"
}

build_all() {
  # Domain 9 / Step 9.5 — gate every image build on the tooling suite.
  # Runs, in order: typecheck -> lint -> (smoke) -> test -> build. Any failure
  # exits non-zero and aborts before an image is pushed, so a broken export
  # (the 2026-08 `validateCitations` case) fails HERE, never at Cloud Run boot.
  #
  # rag-api AND rag-ingest are strict TS: their resolve/compile guard is
  # `tsc -p tsconfig.build.json` (`check_build=1`), so they have NO separate
  # smoke script. The frontend's resolve guard is `vite build` (check_build=1).
  run_checks rag-api 1
  run_checks rag-ingest 1
  run_checks frontend 1
  build_image rag-api rag-api
  build_image rag-ingest rag-ingest
  build_image frontend rag-frontend
}

# Domain 9 / Step 9.5 — the tooling gate.
# order: typecheck -> lint -> knip -> test -> build.
# Every package is now strict TS (rag-api, rag-ingest) or strict TS + build
# dist-based (frontend): the compiled `tsc -p tsconfig.build.json` / `vite build`
# (`check_build=1`) is the module/export resolve guard. No package carries a
# standalone `smoke` script; `check_build=0` is unused but kept for flexibility.
# `knip` is the dead-code gate. It runs HERE (full source + tests present), NOT
# inside `npm run build` — the Docker build only copies lib/src (no tests), so
# knip would misreport dev-only deps and test-only exports there.
run_checks() {
  local dir="$1" check_build="${2:-0}"
  echo "==> Checks: ${dir}"
  ( cd "$ROOT/$dir" && npm run typecheck )
  ( cd "$ROOT/$dir" && npm run lint )
  ( cd "$ROOT/$dir" && npm run knip )
  ( cd "$ROOT/$dir" && npm test )
  if [[ "$check_build" == "1" ]]; then
    ( cd "$ROOT/$dir" && npm run build )
    echo "==> Checks ok (incl. build): ${dir}"
  else
    echo "==> Checks ok: ${dir}"
  fi
}

push_all() {
  write_tfvars
  build_all
}

echo "Using image tag: ${IMAGE_TAG}"

case "${1:-build}" in
  build)  build_all ;;
  push)   push_all ;;
  plan)   push_all; (cd "$ROOT" && ./tf.sh plan) ;;
  apply)  push_all; (cd "$ROOT" && ./tf.sh apply) ;;
  *)      echo "usage: $0 {build|push|plan|apply}" >&2; exit 2 ;;
esac