locals {
  # Artifact Registry docker endpoint for this project + region.
  image_registry = "${var.region}-docker.pkg.dev/${var.project_id}"
}
