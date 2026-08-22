# ---------------------------------------------------------------------------
# Step 1.5 — Secret Manager (OpenRouter key)
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "openrouter" {
  secret_id = "openrouter-key"

  replication {
    auto {}
  }
}

# NOTE: the secret VALUE is NOT managed by Terraform. `./tf.sh secret set
# openrouter-key <value>` writes the active version directly to Secret Manager,
# so plan/apply never ask for `openrouter_api_key`. Terraform owns the secret
# container + IAM accessors only.

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
