# README

## Project Info

| Component | Value |
| ----------- | --------- |
| Project name | Demo RAG Northwind Outfitters |
| Project ID | `rag-demo-no-506313-t5` |
| Region | `europe-west4`
| Backend | Node.js (Cloud Run Service `rag-api`) |
| Frontend | Vue 3 + Vite (static build, served by Cloud Run) |
| Vector store + state | Cloud Firestore (`findNearest`, COSINE) |
| Embeddings + chat | OpenRouter (`openai/text-embedding-3-small` + chosen chat model) |
| IaC | Terraform (`hashicorp/google` + `google-beta`) |
| CI/CD | `deploy.sh` -> Artifact Registry (repo `rag`) -> Terraform apply |

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

## Deploy & Release (build → push → apply)

Build the two container images (`rag-api`, `rag-ingest`), push them to Artifact
Registry, and roll them to Cloud Run via **`deploy.sh`**. Terraform is the sole
deployment controller — no `gcloud run deploy` sidesteps.

Each release is pinned to the **current git short SHA** (e.g. `499c540`), written
to the committed `infra/terraform.tfvars`, so a fresh tag makes `apply` genuinely
redeploy (no silent `:latest` no-op).

```bash
# Build both images locally (no push)
./deploy.sh build

# Build + push, pin the tag in infra/terraform.tfvars
./deploy.sh push

# Build + push, then run a terraform plan (dry-run of the rollout)
./deploy.sh plan

# Build + push, then apply (interactive confirm)
./deploy.sh apply
```

After a **code/corpus change**, commit it **first** so the git-SHA tag bumps —
otherwise `apply` sees the same tag and is a no-op:

```bash
git add -A && git commit -m "your change"          # tag now advances
./deploy.sh plan                                   # expect "2 to change"
./tf.sh apply                                      # if the plan looks good
```

Useful one-liners:

```bash
# Redeploy ONLY rag-api (skip the corpus job image)
IMAGE_TAG=my-tag ./deploy.sh build                # override the tag manually

# Point Terraform at a specific already-pushed tag
sed -i '' 's|image_tag = .*|image_tag = "499c540"|' infra/terraform.tfvars

# Health / liveness checks on the running service (after apply)
curl -s https://rag-api-4xxip75eoa-ez.a.run.app/livez
curl -s https://rag-api-4xxip75eoa-ez.a.run.app/readyz
```

### JOB : once apply is done, kick the seed job

```bash
gcloud run jobs execute rag-ingest --region=europe-west4
```

> **Why the seed job sometimes writes `chunkCount: 0` — and the re-seed flow.**
> The seeder is **idempotent**: it compares the manifest version
> (`corpus/manifest.version`) against the job's `CURRENT_VERSION`
> (`rag-ingest/lib/orchestrate.js`). If they match, it exits `already-seeded`
> and writes nothing. So re-running the *same* job never re-seeds — that's by
> design. Two things must both be true for a real seed to happen:
>
> 1. **The deployed `rag-ingest` image must actually contain the corpus.**
>    `CORPUS_DIR=/corpus` reads corpus baked into the *specific image tag* the
>    job references (`infra/terraform.tfvars`, `image_tag = <git-sha>`). If the
>    corpus was added to git *after* that tag was built/pushed/rolled out, the
>    running job sees zero files → `chunkCount: 0`. Fix: commit first (SHA
>    bumps), `./deploy.sh push`, then `./tf.sh apply`.
> 2. **`CURRENT_VERSION` must differ from the stored manifest version.** If the
>    stored manifest was written by an older/broken run (e.g. a zero-chunk seed)
>    but still carries the *same* version, the gate treats it as "already
>    seeded" and skips — even though nothing is in the `chunks` collection.
>    Bump `CURRENT_VERSION` in `rag-ingest/lib/orchestrate.js` to force a real
>    re-seed, commit, push, apply, then execute the job again.

> **Why `./deploy.sh plan` says "No changes" even after you edited code/corpus**
> — **commit first.** `deploy.sh` tags the image with the **current git short
> SHA of HEAD** (`git rev-parse --short HEAD`), not your working tree. If your
> edits are uncommitted, HEAD is unchanged, so the pushed tag equals the
> already-applied tag → the HCL image reference string is identical → Terraform
> has nothing to roll and reports `No changes`. The tag only advances when HEAD
> becomes a *new commit*:
>
> ```bash
> git add -A && git commit -m "your change"   # SHA now bumps (e.g. 291ee27 -> b7c3f19)
> ./deploy.sh plan                           # now expect "2 to change" (Service + Job)
> ```
>
> So the golden rule for **any** release: commit (bump the SHA) → push/plan →
> apply → (for corpus changes) execute the seed job.
