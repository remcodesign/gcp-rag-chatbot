variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "rag-demo-no-506313-t5"
}

variable "region" {
  description = "GCP region for all resources (Verify: Firestore vector-search availability here)"
  type        = string
  default     = "europe-west4"
}

variable "openrouter_api_key" {
  description = "OpenRouter API key. Pass via TF_VAR_openrouter_api_key or env — never commit."
  type        = string
  sensitive   = true

  # Reject an empty/missing key at plan time (spec's non-happy path) rather
  # than fail later during apply.
  validation {
    condition     = var.openrouter_api_key != ""
    error_message = "openrouter_api_key must be a non-empty OpenRouter API key."
  }
}

variable "artifact_registry_repo" {
  description = "Artifact Registry repository name holding both container images"
  type        = string
  default     = "rag"
}
