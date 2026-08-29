# ---------------------------------------------------------------------------
# rag-bff — the public choke point (Cloud Run Service)
# ---------------------------------------------------------------------------
# The BFF is a thin public service that rate-limits the expensive SSE POSTs
# (per client IP + per session) and proxies them to the PRIVATE rag-api using
# the BFF's service identity (IAM). The frontend calls the BFF same-origin via
# nginx; rag-api is no longer public.
#
# This makes rag-api private: only the BFF's service account can invoke it.
# A hostile caller hitting rag-api directly now gets 403 (IAM), and a hostile
# caller hitting the BFF is bounded by rate limiting.

# Service account for the BFF.
resource "google_service_account" "bff" {
  account_id   = "rag-bff-sa"
  display_name = "RAG BFF service account"
}

# Firestore access is NOT needed by the BFF (it only proxies). It needs the
# ability to invoke rag-api (run.invoker on the rag-api service) — see below.

# The BFF Cloud Run Service.
resource "google_cloud_run_service" "bff" {
  name       = "rag-bff"
  location   = var.region
  depends_on = [google_project_iam_member.terraform_runner_run_admin]

  template {
    metadata {
      annotations = {
        # Cheap stickiness: prefer the same instance while warm.
        "run.googleapis.com/sessionAffinity" = "true"
        # Free cold-start accelerator: extra CPU during the startup window so
        # the proxy boots faster. No always-on cost.
        "run.googleapis.com/startup-cpu-boost" = "true"
      }
    }
    spec {
      # The BFF is a thin proxy; many concurrent lightweight requests per instance.
      container_concurrency = 1000

      timeout_seconds = 300

      containers {
        image = local.bff_image
        ports {
          container_port = 8080
        }

        # The private rag-api base URL the BFF proxies to.
        # Constructed with the project number + dots (portable, no hardcoded
        # per-project hash): https://<service>-<project-number>.<region>.run.app
        env {
          name  = "RAG_API_BASE"
          value = "https://${google_cloud_run_service.api.name}-${data.google_project.project.number}.${var.region}.run.app"
        }

        # Rate-limit knobs (per client IP + per session).
        env {
          name  = "RATE_WINDOW_MS"
          value = "60000"
        }
        env {
          name  = "RATE_MAX_PER_IP"
          value = "20"
        }
        env {
          name  = "RATE_MAX_PER_SESSION"
          value = "10"
        }
      }

      service_account_name = google_service_account.bff.email
    }
  }

  traffic {
    latest_revision = true
    percent         = 100
  }
}

# The BFF is public (the frontend's nginx proxies to it same-origin).
resource "google_cloud_run_service_iam_member" "bff_public" {
  service  = google_cloud_run_service.bff.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# rag-api is made PRIVATE in cloud_run.tf (api_private): only the BFF's SA can
# invoke it. The BFF's SA mints an OIDC token for the rag-api audience via the
# metadata server using its default identity.