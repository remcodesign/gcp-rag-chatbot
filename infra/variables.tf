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

variable "terraform_runner_sa" {
  description = "Service account that runs Terraform (the CI/deploy identity whose key tf.sh fetches from the state bucket). Its deploy role is codified here so a fresh apply rebuilds it from a blank project (terraforming the tooling identity)."
  type        = string
  default     = "terraform-runner"
}

variable "thinking_mode_on" {
  description = "Enable LLM reasoning/thinking on rag-api chat (default false = non-thinking, faster/cheaper). For now a git-committed fixed choice; could later be driven per-session from Firestore."
  type        = bool
  default     = false
}

variable "min_score" {
  description = "Minimum retrieval relevance score (0..1) for a chunk to be kept in the LLM context. Higher = fewer, more relevant sources."
  type        = number
  default     = 0.35
}

variable "cors_allowed_origins" {
  description = "Comma-separated CORS origin allowlist for the rag-api SSE endpoint. Only these origins may call it from a browser. Defaults to the deployed frontend URL + localhost for local dev."
  type        = string
  default     = "https://rag-frontend-346411608497.europe-west4.run.app,http://localhost:5174"
}

variable "rate_window_ms" {
  description = "Nitro BFF rate-limit window length in ms (per client IP + per session)."
  type        = number
  default     = 60000
}

variable "rate_max_per_ip" {
  description = "Nitro BFF max requests per client IP within the window."
  type        = number
  default     = 10
}

variable "rate_max_per_session" {
  description = "Nitro BFF max requests per session id within the window."
  type        = number
  default     = 4
}
