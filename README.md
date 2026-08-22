# README

## Project Info

| Component | Value |
| ----------- | --------- |
| Project name | Demo RAG Northwind Outfitters |
| Project ID | `rag-demo-no-506313-t5` |
| Region | `europe-west1` (verify Firestore vector-search availability) |
| Backend | Node.js (Cloud Run Service `rag-api`) |
| Frontend | Vue 3 + Vite (static build, served by Cloud Run) |
| Vector store + state | Cloud Firestore (`findNearest`, COSINE) |
| Embeddings + chat | OpenRouter (`openai/text-embedding-3-small` + chosen chat model) |
| IaC | Terraform (`hashicorp/google` + `google-beta`) |
| CI/CD | Cloud Build + Artifact Registry (repo `rag`) |

**Architecture in one line:** one Firestore = vector store + session/event/message state; OpenRouter = embeddings + streaming chat; GCP footprint ≈ €0/mo (all serverless, scales to zero). No Cloud SQL, no VPC connector, no BigQuery.

Full build spec: [`docs/1-1-idea-specs.md`](docs/1-1-idea-specs.md)

<!-- --------------------------------------------------------------- -->

## Google Cloud CLI

```bash
# gcloud login
gcloud auth login

# set current project id
gcloud config set project XXX

# get current project id
gcloud config get-value project

# current login info
gcloud config list
```

## Terraform CLI (init and daily commands)

**Recommended:** use the wrapper script **`./tf.sh`** from the repo root. It
fetches `credentials.json` from the shared bucket into a temp file, points
`GOOGLE_APPLICATION_CREDENTIALS` at it, then runs Terraform against the remote
GCS backend — so you never have to carry credentials around yourself.

```bash
# From the repo root (anywhere). The script finds infra/ itself.
# From the repo root (anywhere). The script finds infra/ itself.
./tf.sh init                      # init backend, load remote state
./tf.sh init -migrate-state     # once, if coming from a local backend
./tf.sh plan                    # plan + open color-coded HTML viewer
./tf.sh plan-view               # explicit alias for plan + viewer
./tf.sh apply                   # init + apply (confirm prompt)
./tf.sh apply -auto-approve     # non-interactive (CI)
./tf.sh destroy                 # init + destroy
./tf.sh validate                # schema check (no creds needed)
./tf.sh state list              # any terraform command passes through

# Provide the OpenRouter key when plan/apply need it:
TF_VAR_openrouter_api_key=sk-... ./tf.sh plan
```

**Plan viewer** — run the plan and open a color-coded HTML report (NEW /
CHANGE / REPLACE / DELETE / UNCHANGED / READ) in your browser:

```bash
./tf.sh plan-view              # generates a plan and opens the web viewer
PLAN_VIEW_OUT=~/plan.html ./tf.sh plan-view   # write the report elsewhere
```

The same commands run directly from `infra/` if you prefer (the raw Terraform
CLI). State lives in GCS (see "Remote state" below), so **every command that
touches the backend needs Google credentials** — `plan`, `apply`, `destroy`
and even `init` (to reach the bucket).

```bash
cd infra

# One-time: authenticate (macOS). Any user who runs terraform needs this.
gcloud auth application-default login

# --- Init -------------------------------------------------------------------
# First time / after changing the backend block or provider versions:
terraform init
# Coming from the old local backend? Pull local state into GCS once:
terraform init -migrate-state
# Force re-init after backend edits (discards cached backend config):
terraform init -reconfigure

# --- Validate / plan --------------------------------------------------------
terraform validate                        # schema check, no remote needed
terraform plan                            # reads remote state, dry-run of changes
TF_VAR_openrouter_api_key=sk-... terraform plan   # plan with the secret var

# --- Apply / destroy --------------------------------------------------------
TF_VAR_openrouter_api_key=sk-... terraform apply       # apply + confirm
TF_VAR_openrouter_api_key=sk-... terraform apply -auto-approve   # CI / non-interactive
TF_VAR_openrouter_api_key=sk-... terraform destroy     # tear down everything

# --- Inspect remote state ----------------------------------------------------
terraform state list                          # resources tracked in GCS state
terraform state show <address>                # details of one resource
terraform output                              # outputs (e.g. service URL)

# --- Multiple users / workspaces ---------------------------------------------
terraform workspace list                      # environments: default, dev, prod, ...
terraform workspace new dev                   # each gets a state under prefix/<ws>
terraform workspace select default
# Reflect the workspace in state path: run `terraform init` after switching.
```

### OpenRouter key — bootstrap vs. rotate

Two distinct layers handle the key (see also the `secrets.tf` notes):

- **Runtime (Secret Manager):** the `rag-api` / `rag-ingest` containers read
  `OPENROUTER_API_KEY` from the `openrouter-key` secret. This is the store that
  matters in production.
- **Bootstrap (Terraform input):** the *first* `apply` needs a value to create
  the secret version, passed via `TF_VAR_openrouter_api_key`. A placeholder
  is fine to create the secret — afterwards the key lives only in Secret
  Manager.

Recommended flow:

```bash
# First deploy: create infra + a placeholder secret version.
TF_VAR_openrouter_api_key=sk-placeholder ./tf.sh apply

# Then put the real key into Secret Manager (no Terraform involvement).
# Every secret uses the same syntax: ./tf.sh secret set <name> <value>
./tf.sh secret set openrouter-key sk-live-REAL-KEY

# List which secrets exist (just the names):
./tf.sh secret list

# Verify the active version (redacted - only shows a prefix):
./tf.sh secret show openrouter-key

# Multiple secrets? Same syntax, different name:
./tf.sh secret set another-secret sk-other-...
./tf.sh secret show another-secret

# Rotate later: just add a new version; Cloud Run picks it up on next deploy.
./tf.sh secret set openrouter-key sk-live-NEW-KEY
```

**Security rules:** never commit the key, never print the full value — the
`secret` helper prints only a prefix. Use `gcloud secrets` / the console UI for
manual rotation as an alternative.

> **Notes**
>
> - `openrouter_api_key` is a `sensitive` variable with a non-empty `validation` — an empty key fails at `plan`, not `apply`. It is never committed.
> - **Remote state needs credentials too**: `terraform init`, `plan`, `apply`, and `destroy` all contact GCS to read/lock state, so they require Application Default Credentials *and* bucket access (not just `run.invoker`). The sandbox/CI environment typically lacks these, so these run from your machine or a properly authed runner.
> - **Concurrency:** the GCS backend auto-locks state. If two users `apply` at once, the loser waits — use `-lock-timeout=5m` to fail fast instead of hanging.
> - **Switching workspaces:** the GCS backend stores each workspace under `prefix = "terraform/state/<workspace>"`, so `default` vs `dev` vs `prod` get isolated, separate state files.
> - After editing `versions.tf` or the backend, re-run `terraform init` (Terraform reminds you otherwise, or use `-reconfigure`).
> - Shortcuts: `terraform fmt -recursive` before committing keeps files tidy; `terraform validate` is the fast sanity check.

### Remote state (GCS backend)

- State is stored in the GCS bucket **`rag-demo-no-506313-t5-terraform-state`** under prefix `terraform/state`.
- **The bucket must already exist** before `terraform init` — Terraform does not create it. Create it once with:

  ```bash
  gcloud storage buckets create gs://rag-demo-no-506313-t5-terraform-state \
    --project=rag-demo-no-506313-t5 \
    --location=europe-west4 \
    --uniform-bucket-level-access
  ```

- **Encryption:** GCS encrypts all objects at rest by default with Google-managed keys — no extra config needed. For stronger control you can later attach a Customer-Managed Encryption Key (CMEK) via `--encryption-key` / KMS.
- **Multi-user / lost laptop:** because state lives in the bucket, any user (or CI runner) with access to the project can `terraform init` and deploy to the same target. Use `terraform state lock` (GCS backend enables it automatically) to prevent concurrent applies.
- **Access control:** restrict who can read/write the bucket (e.g. `roles/storage.objectAdmin` on the bucket) so state — which contains resource metadata — is only visible to the team.

<!-- --------------------------------------------------------------- -->