# ---------------------------------------------------------------------------
# Step 1.2 — Cloud Run Service (the streaming backend)
# ---------------------------------------------------------------------------
# TEMP-DISABLED: rag-api/rag-ingest reference container images
# (${region}-docker.pkg.dev/.../rag-api:latest, .../rag-ingest:latest) that are
# built from the app code shipped in LATER domains (4/5/6). Cloud Run refuses a
# Service/Job whose image does not exist, which blocks every `terraform apply`
# in the meantime. Un-comment these two blocks once the images are pushed
# (Domains 4–6), then re-run apply. Done in Domain 1 to keep a green exit state.
# ---------------------------------------------------------------------------

# resource "google_cloud_run_service" "api" {
#   name     = "rag-api"
#   location = var.region
#
#   template {
#     metadata {
#       annotations = {
#         # Cheap stickiness: route a client's requests to the same instance while
#         # the instance is warm, mitigating "instances hopping" during SSE.
#         # (In the v1 API session affinity is configured via this annotation.)
#         "run.googleapis.com/sessionAffinity" = "true"
#       }
#     }
#     spec {
#       # Many concurrent SSE streams per instance (fewer instances to hop between).
#       container_concurrency = 100
#
#       # Must exceed max stream length or Cloud Run kills SSE mid-answer.
#       timeout_seconds = 300
#
#       containers {
#         image = "${local.image_registry}/${var.artifact_registry_repo}/rag-api:latest"
#         ports {
#           container_port = 8080
#         }
#
#         env {
#           name = "OPENROUTER_API_KEY"
#           value_from {
#             secret_key_ref {
#               name = google_secret_manager_secret.openrouter.secret_id
#               key  = "latest"
#             }
#           }
#         }
#       }
#
#       service_account_name = google_service_account.api.email
#     }
#   }
#
#   traffic {
#     latest_revision = true
#     percent         = 100
#   }
# }
#
# # Demo: public. Switch to allAuthenticatedUsers + Identity Platform for prod.
# resource "google_cloud_run_service_iam_member" "public" {
#   service  = google_cloud_run_service.api.name
#   location = var.region
#   role     = "roles/run.invoker"
#   member   = "allUsers"
# }

# ---------------------------------------------------------------------------
# Step 1.3 — Cloud Run Job (one-time corpus seeder)
# ---------------------------------------------------------------------------
# Uses the v2 API resource (the v1 `google_cloud_run_job` does not exist in the
# installed provider). deletion_protection must be explicitly false to allow
# `terraform destroy` to remove the job. TEMP-DISABLED (see top of this file).

# resource "google_cloud_run_v2_job" "ingest" {
#   name                = "rag-ingest"
#   location            = var.region
#   deletion_protection = false
#
#   template {
#     # Run to completion; one task, no parallelism.
#     task_count  = 1
#     parallelism = 1
#
#     template {
#       # Up to 24h max per run (per-attempt task timeout).
#       timeout = "86400s"
#
#       service_account = google_service_account.job.email
#
#       containers {
#         image = "${local.image_registry}/${var.artifact_registry_repo}/rag-ingest:latest"
#
#         env {
#           name = "OPENROUTER_API_KEY"
#           value_source {
#             secret_key_ref {
#               secret  = google_secret_manager_secret.openrouter.secret_id
#               version = "latest"
#             }
#           }
#         }
#       }
#     }
#   }
# }
