# ---------------------------------------------------------------------------
# Step 1.4 — Cloud Firestore (vector store + state)
# ---------------------------------------------------------------------------
# NO google_sql_database_instance
# NO google_vpc_access_connector / network / subnetwork

resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  type        = "FIRESTORE_NATIVE" # vector fields live here
  location_id = var.region         # Verify: region where Firestore vector search is available
}

# ---------------------------------------------------------------------------
# Security rules: deny unauthenticated/no-caller writes. The two service
# accounts read/write via ADC (service-account access is not gated by client
# security rules), matching the locked "deny public" decision.
# ---------------------------------------------------------------------------

resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = <<-EOT
        service cloud.firestore {
          match /databases/{database}/documents {
            match /{document=**} {
              allow read, write: if false;
            }
          }
        }
      EOT
    }
  }
}

resource "google_firebaserules_release" "firestore" {
  name         = "cloud.firestore"
  project      = var.project_id
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"
}

# ---------------------------------------------------------------------------
# Session TTL (Domain 2, Step 2.3): stale `sessions` docs are auto-expired
# based on the `expiresAt` timestamp field (set by the app) via a Firestore
# TTL policy. No offset: the app owns the exact expiration time.
# ---------------------------------------------------------------------------

resource "google_firestore_field" "sessions_expires_at" {
  project    = var.project_id
  database   = google_firestore_database.main.name
  collection = "sessions"
  field      = "expiresAt"

  ttl_config {} # expiring docs identified by the timestamp in `expiresAt`
}
