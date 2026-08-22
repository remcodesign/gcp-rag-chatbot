terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # Remote state in GCS: survives a lost laptop and lets multiple users deploy
  # to the same project. The bucket must already exist (see README-local.md).
  # GCS encrypts objects at rest by default (Google-managed keys).
  backend "gcs" {
    bucket = "rag-demo-no-506313-t5-terraform-state"
    prefix = "terraform/state"
  }
}
