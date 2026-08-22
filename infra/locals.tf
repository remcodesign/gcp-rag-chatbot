locals {
  # Artifact Registry docker endpoint for this project + region.
  image_registry = "${var.region}-docker.pkg.dev/${var.project_id}"

  # Full image reference (registry/repo/name:tag). The tag is variable-controlled
  # so Terraform sees a change on each release and redeploys.
  api_image      = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo}/rag-api:${var.image_tag}"
  ingest_image   = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo}/rag-ingest:${var.image_tag}"
  frontend_image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo}/rag-frontend:${var.image_tag}"
}
