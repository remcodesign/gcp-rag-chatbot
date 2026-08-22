# ---------------------------------------------------------------------------
# Step 1.5 — Secret Manager (OpenRouter key)
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "openrouter" {
  secret_id = "openrouter-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "current" {
  secret      = google_secret_manager_secret.openrouter.name
  secret_data = var.openrouter_api_key # passed via TF_VAR / env, never committed
}

# Grant accessor to both service accounts.
resource "google_secret_manager_secret_iam_member" "api" {
  secret_id = google_secret_manager_secret.openrouter.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "job" {
  secret_id = google_secret_manager_secret.openrouter.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.job.email}"
}
