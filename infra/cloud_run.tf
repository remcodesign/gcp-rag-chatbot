# ---------------------------------------------------------------------------
# Step 1.2 — Cloud Run Service (the streaming backend)
# ---------------------------------------------------------------------------
# Enabled: images exist in Artifact Registry (`rag-api:latest`).
# Build + push first (see docs/1-1-domain-8-deploy-cloud-run.md).

resource "google_cloud_run_service" "api" {
  name     = "rag-api"
  location = var.region
  # Ordering so `terraform destroy` removes the runner's deploy role last: keep
  # run.admin until the Cloud Run resources are gone (the runner needs it to
  # delete them). On destroy, dependencies are removed after their dependents.
  depends_on = [google_project_iam_member.terraform_runner_run_admin]

  template {
    metadata {
      annotations = {
        # Cheap stickiness: route a client's requests to the same instance while
        # the instance is warm, mitigating "instances hopping" during SSE.
        "run.googleapis.com/sessionAffinity" = "true"
        # Free cold-start accelerator: extra CPU during the startup window so
        # the Firestore + OpenRouter client boot is faster. No always-on cost.
        "run.googleapis.com/startup-cpu-boost" = "true"
      }
    }
    spec {
      # Many concurrent SSE streams per instance (fewer instances to hop between).
      container_concurrency = 100

      # Must exceed max stream length or Cloud Run kills SSE mid-answer.
      timeout_seconds = 300

      containers {
        image = local.api_image
        ports {
          container_port = 8080
        }

        env {
          name = "OPENROUTER_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.openrouter.secret_id
              key  = "latest"
            }
          }
        }

        # Thinking mode toggle (variable-controlled, git-committed). Maps 1:1 to
        # the rag-api env var of the same name; when false, rag-api sends no
        # `reasoning` override (model stays native, e.g. non-thinking gpt-oss).
        env {
          name  = "THINKING_MODE_ON"
          value = var.thinking_mode_on ? "true" : "false"
        }

        # Minimum retrieval relevance (0..1) for sources kept in context.
        env {
          name  = "MIN_SCORE"
          value = tostring(var.min_score)
        }

        # CORS origin allowlist (comma-separated). Only these origins may call
        # the SSE endpoint from a browser. The deployed frontend URL is the
        # production caller; localhost is for local dev against a deployed API.
        env {
          name  = "CORS_ALLOWED_ORIGINS"
          value = var.cors_allowed_origins
        }
      }

      service_account_name = google_service_account.api.email
    }
  }

  traffic {
    latest_revision = true
    percent         = 100
  }
}

# rag-api is now PRIVATE: only the BFF's service account can invoke it (see
# bff.tf). The public allUsers invoker is removed so a hostile caller hitting
# rag-api directly gets 403 (IAM). The BFF is the public entry point.
resource "google_cloud_run_service_iam_member" "api_private" {
  service  = google_cloud_run_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.bff.email}"
}

# --- Frontend: the separate static site (Cloud Run Service) ---
# Serves the built Vue 3 app from `frontend/dist` via nginx.
resource "google_cloud_run_service" "frontend" {
  name     = "rag-frontend"
  location = var.region
  # Ordering so a fresh `terraform apply` can recreate the deploy role from a blank
  # project; also so `terraform destroy` drops the static site before the runner role.
  depends_on = [google_project_iam_member.terraform_runner_run_admin]

  template {
    metadata {
      annotations = {
        # Cheap stickiness: prefer the same instance while warm.
        "run.googleapis.com/sessionAffinity" = "true"
      }
    }
    spec {
      # Static files -> many concurrent lightweight requests per instance.
      container_concurrency = 1000

      timeout_seconds = 300

      containers {
        image = local.frontend_image
        ports {
          container_port = 8080
        }

        # The BFF origin the nginx proxy forwards /sessions/* to. Same-origin
        # from the browser's perspective (nginx proxies internally), so no CORS.
        # Constructed with the project number + dots (portable, no hardcoded
        # per-project hash): https://<service>-<project-number>.<region>.run.app
        env {
          name  = "BFF_URL"
          value = "https://${google_cloud_run_service.bff.name}-${data.google_project.project.number}.${var.region}.run.app"
        }
      }

      service_account_name = google_service_account.api.email
    }
  }

  traffic {
    latest_revision = true
    percent         = 100
  }
}

# Demo: public. Switch to allAuthenticatedUsers + Identity Platform for prod.
resource "google_cloud_run_service_iam_member" "frontend_public" {
  service  = google_cloud_run_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Step 1.3 — Cloud Run Job (one-time corpus seeder)
# ---------------------------------------------------------------------------
# Uses the v2 API resource (the v1 `google_cloud_run_job` does not exist in the
# installed provider). deletion_protection must be explicitly false to allow
# `terraform destroy` to remove the job.

resource "google_cloud_run_v2_job" "ingest" {
  name                = "rag-ingest"
  location            = var.region
  deletion_protection = false
  # Same destroy-ordering as the Service: keep run.admin on the runner until the
  # Job is gone (see the depends_on comment on google_cloud_run_service.api).
  depends_on = [google_project_iam_member.terraform_runner_run_admin]

  template {
    # Run to completion; one task, no parallelism.
    task_count  = 1
    parallelism = 1

    template {
      # Up to 24h max per run (per-attempt task timeout).
      timeout = "86400s"

      service_account = google_service_account.job.email

      containers {
        image = local.ingest_image

        env {
          name = "OPENROUTER_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.openrouter.secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "CORPUS_DIR"
          value = "/app/corpus"
        }
      }
    }
  }
}