#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# tf.sh — Terraform convenience wrapper for this project.
#
# Fetches your GCP credentials.json from the shared state bucket into a
# temporary location, points GOOGLE_APPLICATION_CREDENTIALS at it, then runs
# terraform against the remote GCS backend. Run from anywhere in the repo.
#
# Usage:
#   ./tf.sh init                  # terraform init (load remote state)
#   ./tf.sh init -migrate-state   # once, if coming from a local backend
#   ./tf.sh plan                  # plan + open the HTML viewer (see plan-view)
#   ./tf.sh plan-view             # explicit alias for the plan + viewer
#   ./tf.sh apply                 # init + apply (confirm prompt)
#   ./tf.sh apply -auto-approve   # non-interactive (CI)
#   ./tf.sh destroy               # init + destroy
#   ./tf.sh validate              # schema check (no creds needed)
#   ./tf.sh secret set openrouter-key sk-...  # bootstrap/rotate a secret
#   ./tf.sh secret show openrouter-key        # redacted active version
#   ./tf.sh secret list                       # all secret names in the project
#   ./tf.sh ...                               # any other terraform command, e.g. ./tf.sh state list
#
# Optional: provide the Terraform input value for the OpenRouter key when
# plan/apply create the secret for the FIRST time:
#   TF_VAR_openrouter_api_key=sk-... ./tf.sh plan
# ---------------------------------------------------------------------------
set -euo pipefail

# ---- Config -----------------------------------------------------------------
BUCKET="${TF_BUCKET:-rag-demo-no-506313-t5-terraform-state}"
CRED_OBJECT="credentials.json"                 # object inside the bucket
PROJECT_ID="rag-demo-no-506313-t5"
REGION="europe-west4"

# Resolve the repo root (parent of this script) and the infra dir.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/infra"
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
GCLOUD_BIN="${GCLOUD_BIN:-gcloud}"
GSUTIL_BIN="${GSUTIL_BIN:-gsutil}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
OPEN_BIN="${OPEN_BIN:-open}"          # macOS; Linux users can set BROWSER

# --- Helpers ------------------------------------------------------------------
die() { echo "error: $*" >&2; exit 1; }

fetch_credentials() {
  local tmp="$1"
  local cred_file="$tmp/credentials.json"

  # Use gsutil (or fall back to the newer gcloud storage when available).
  if command -v "$GSUTIL_BIN" >/dev/null 2>&1; then
    "$GSUTIL_BIN" cp "gs://$BUCKET/$CRED_OBJECT" "$cred_file" >/dev/null
  else
    "$GCLOUD_BIN" storage cp "gs://$BUCKET/$CRED_OBJECT" "$cred_file" >/dev/null
  fi

  export GOOGLE_APPLICATION_CREDENTIALS="$cred_file"
  echo "Using credentials from gs://$BUCKET/$CRED_OBJECT"
}

# All secret actions require an explicit secret name, so every secret is
# handled with the same syntax:
#   ./tf.sh secret set  <name> <value>   # add/rotate a version
#   ./tf.sh secret show <name>           # show active version (redacted)

secret_set() {
  local sname="$1" value="${2:-}"
  [[ -n "$value" ]] || die "usage: ./tf.sh secret set <name> <value>"
  printf '%s' "$value" | "$GCLOUD_BIN" secrets versions add "$sname" \
    --data-file=- \
    --project="$PROJECT_ID" >/dev/null
  echo "New version added to Secret Manager '$sname'."
}

secret_current() {
  local sname="$1" v
  v="$("$GCLOUD_BIN" secrets versions access latest --secret="$sname" --project="$PROJECT_ID" 2>/dev/null)" || { echo "No active version for '$sname' yet." >&2; return 1; }
  echo "Secret '$sname' active version starts with: ${v:0:8}... (len ${#v})"
}

run_secret() {
  local action="${1:-show}"
  shift 2>/dev/null || true
  case "$action" in
    set)
      # Always require an explicit secret name + value.
      [[ $# -ge 2 ]] || die "usage: ./tf.sh secret set <name> <value>"
      secret_set "$1" "$2"
      ;;
    list)
      # List all secret names in the project.
      "$GCLOUD_BIN" secrets list --project="$PROJECT_ID" --format="value(name)"
      ;;
    show|current)
      # Always require an explicit secret name.
      [[ $# -ge 1 ]] || die "usage: ./tf.sh secret show <name>"
      secret_current "$1"
      ;;
    *)
      die "usage: ./tf.sh secret {set <name> <value> | show <name> | list}"
      ;;
  esac
}

run_plan_view() {
  cd "$INFRA_DIR"

  # Use a global so the EXIT/RETURN trap can see it even after locals go out
  # of scope (avoids 'tmp_dir: unbound variable' under set -u).
  _TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$_TMP_DIR"' RETURN EXIT

  fetch_credentials "$_TMP_DIR"

  local plan_file="$_TMP_DIR/plan.tfplan"
  local plan_json="$_TMP_DIR/plan.json"
  local out_html="${PLAN_VIEW_OUT:-$SCRIPT_DIR/plan-view.html}"
  local report_py="$SCRIPT_DIR/tools/plan_report.py"

  [[ -f "$report_py" ]] || die "plan_report.py not found at $report_py"
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "python3 is required for plan-view"

  # 1. Generate the plan to a binary file (from remote state).
  "$TERRAFORM_BIN" plan -out="$plan_file" "$@"

  # 2. Convert to JSON for the report.
  "$TERRAFORM_BIN" show -json "$plan_file" > "$plan_json"

  # 3. Render the HTML report and open it in the default browser.
  "$PYTHON_BIN" "$report_py" "$plan_json" -o "$out_html"
  echo "Plan report: $out_html"

  if command -v "$OPEN_BIN" >/dev/null 2>&1 && [[ "$(uname -s)" == "Darwin" ]]; then
    "$OPEN_BIN" "$out_html"
  else
    echo "Open $out_html manually in your browser."
  fi
}

run_terraform() {
  # Terraform must run from the infra dir (backend config lives there).
  cd "$INFRA_DIR"

  local first="${1:-}"

  # init/plan/apply/destroy touch remote state and need credentials.
  case "$first" in
    plan|apply|destroy|init|refresh|console|import|output|state)
      ;;
    validate|fmt|version)
      # These don't need the backend — skip the credential fetch.
      "$TERRAFORM_BIN" "$@"
      return
      ;;
    *)
      # Unknown/too few args: run terraform as-is, but fetch creds first in
      # case the command talks to the backend (e.g. `output`).
      ;;
  esac

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # Always remove the temp credentials when the script exits. Store the dir in
  # a global so the EXIT trap can resolve it after the local scope is gone.
  _TMP_DIR="$tmp_dir"
  trap 'rm -rf "$_TMP_DIR"' RETURN EXIT

  fetch_credentials "$tmp_dir"
  "$TERRAFORM_BIN" "$@"
}

# --- Main -------------------------------------------------------------------
main() {
  local cmd="${1:-}"
  case "$cmd" in
    secret)
      shift
      run_secret "$@"
      ;;
    plan|plan-view)
      # `plan` and `plan-view` both run the plan and open the HTML viewer.
      shift
      run_plan_view "$@"
      ;;
    *)
      run_terraform "$@"
      ;;
  esac
}

main "$@"