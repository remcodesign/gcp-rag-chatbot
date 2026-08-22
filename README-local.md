# README - Local

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
./tf.sh plan                    # init + plan (dry-run)
./tf.sh apply                   # init + apply (confirm prompt)
./tf.sh apply -auto-approve     # non-interactive (CI)
./tf.sh destroy                 # init + destroy
./tf.sh validate                # schema check (no creds needed)
./tf.sh state list              # any terraform command passes through

# Provide the OpenRouter key when plan/apply need it:
TF_VAR_openrouter_api_key=sk-... ./tf.sh plan
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

## Pre-prompt (paste at top of every new chat)

---

> **VERY IMPORTANT — read and follow these instructions in order:**

### 1.1 Load project context

Read the full build spec first — it is the single source of truth for this greenfield project:

```txt
docs/1-1-idea-specs.md
```

> document per domain in this format, example `docs/1-1-domain-2-external-client-arena.md`

- Important! Do not use special chars in the `Mermaid` diagram labels

- template for the document

```txt
docs/1-1-domain-X-XXX.md.  
```

### 1.2 Extra Documentation

Use the tool `context 7` for more indepth documentation about any of the project subjects.

### 2. Follow the locked decisions

These are locked — do not revisit without explicit approval:

- **Cloud Firestore** is both the vector store (`findNearest`, COSINE) and the session/event/message state store. No Cloud SQL, no VPC connector, no BigQuery.
- **OpenRouter** for both embeddings (`openai/text-embedding-3-small`, 1536 dims, batched array calls) and chat (streaming).
- **Cloud Run Service** `rag-api` = streaming backend (`timeout_seconds >= 300`, `container_concurrency >= 100`, session affinity).
- **Cloud Run Job** `rag-ingest` = one-time, idempotent corpus seeder (≤24h cap).
- **Terraform** owns all GCP resources (`infra/`).
- **Northwind Outfitters** = the fictional e-commerce corpus (products, faq, policies, loyalty, support).

### 3. Follow the build order

Build strictly in this order, domain by domain, with the exit state of each domain verified before moving on:

1. **Domain 1** — Terraform infrastructure skeleton (`infra/`)
2. **Domain 2** — Stateless session/event state in Firestore (`rag-api/lib/state/`)
3. **Domain 3** — RAG pipeline: retrieval + rerank (`rag-api/lib/rag/`)
4. **Domain 4** — Seed corpus job (`rag-ingest/`)
5. **Domain 5** — Streaming generation + source attribution (`rag-api/lib/generate/`)
6. **Domain 6** — Vue 3 frontend (`frontend/`)
7. **Domain 7** — Production hardening (SSE pitfalls)

### 4. Follow existing code style

Before creating or editing a file, check **sibling files** and **related code** for the current patterns:

- Creating a module? Look at existing modules in the same or neighboring directory.
- Creating a test? Check existing tests for the same patterns.
- Creating a Vue component? Check existing components for conventions.

### 5. Core rules

- **No overengineering** — keep it clean, simple, and consistent with the spec.
- **No new dependencies** without explicit approval.
- **Every step in the spec has happy + non-happy tests** — implement both when implementing the step.
- **Deterministic doc IDs** = SHA-256 of chunk text; writes must stay idempotent.
- **Never log** the full prompt text or API keys — log model, count, latency only.
- **Treat LLM-generated metadata as untrusted** — validate inline `[Source N]` citations against the source map.
- **Mid-stream LLM failure** → SSE `error` event + context-assisted regeneration (never re-splice, never HTTP 500 after the stream started).

### 6. After completing the job

Run these in order and fix any errors:

```bash
# Backend (Node)
npm test

# Frontend (builds assets, catches Vite/TypeScript errors)
npm run build

# Infra (when touching infra/)
terraform plan
```

### 7. Tests

- Update tests when the codebase changes — but first verify the code change is correct.
- No need for backward compatibility for most changes (or otherwise stated).
- Run affected tests to confirm they pass and if not fix the errors.

### 8. Verify before building (the only open items)

- Firestore vector-search (`findNearest`) GA availability in `europe-west1`.
- That the OpenRouter key can call `openai/text-embedding-3-small` and the chosen chat model (check pricing).

---

> **The job to be done:**
