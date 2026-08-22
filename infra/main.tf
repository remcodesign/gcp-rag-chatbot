# ---------------------------------------------------------------------------
# Step 1.1 — Provider and project bootstrap
# ---------------------------------------------------------------------------

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Service accounts: one for the streaming backend, one for the seed job.
resource "google_service_account" "api" {
  account_id   = "rag-api-sa"
  display_name = "RAG API service account"
}

resource "google_service_account" "job" {
  account_id   = "rag-job-sa"
  display_name = "RAG ingest job service account"
}

# Firestore access for both SAs (vector store + state).
resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "job_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.job.email}"
}
