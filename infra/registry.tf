# ---------------------------------------------------------------------------
# Step 1.6 — Image build / registry
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "rag" {
  location      = var.region
  repository_id = var.artifact_registry_repo
  description   = "Container images for rag-api and rag-ingest"
  format        = "DOCKER"
}

# Allow both SAs to pull images.
resource "google_artifact_registry_repository_iam_member" "api" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.rag.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.api.email}"
}

resource "google_artifact_registry_repository_iam_member" "job" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.rag.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.job.email}"
}
