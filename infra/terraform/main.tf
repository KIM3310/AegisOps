provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service_account_email = var.create_service_account ? google_service_account.runtime[0].email : var.service_account_email
  invoker_members       = var.allow_unauthenticated ? setunion(var.invoker_members, toset(["allUsers"])) : var.invoker_members
}

resource "google_project_service" "required" {
  for_each           = var.enable_required_services ? local.required_services : toset([])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  count        = var.create_service_account ? 1 : 0
  account_id   = var.service_account_id
  display_name = "${var.service_name} runtime"
  description  = "Runtime identity for ${var.service_name} Cloud Run service."

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = var.secret_env

  project   = var.project_id
  secret_id = each.value.secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.service_account_email}"

  depends_on = [
    google_project_service.required,
    google_service_account.runtime,
  ]
}

resource "google_cloud_run_v2_service" "this" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account       = local.service_account_email
    execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
    timeout               = "${var.timeout_seconds}s"

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.image

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      startup_probe {
        initial_delay_seconds = 5
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 12

        http_get {
          path = var.startup_probe_path
          port = var.container_port
        }
      }

      liveness_probe {
        initial_delay_seconds = 30
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3

        http_get {
          path = var.health_check_path
          port = var.container_port
        }
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }
    }
  }

  labels = var.labels

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.runtime_accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = local.invoker_members

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = each.value
}
