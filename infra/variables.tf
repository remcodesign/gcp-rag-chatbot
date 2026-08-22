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

# NOTE: there is intentionally NO `openrouter_api_key` variable here. The secret
# value lives only in Secret Manager (`./tf.sh secret set openrouter-key <value>`),
# so plan/apply never prompt for the key.

variable "artifact_registry_repo" {
  description = "Artifact Registry repository name holding both container images"
  type        = string
  default     = "rag"
}

variable "image_tag" {
  description = "Container image tag to deploy. Every release pins a new tag so a fresh `terraform apply` actually redeploys the Service/Job (avoids the silent no-op of a static :latest)."
  type        = string
  default     = "latest"
}
