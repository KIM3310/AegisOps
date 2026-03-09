output "service_uri" {
  value       = google_cloud_run_v2_service.this.uri
  description = "Cloud Run URL"
}

output "service_name" {
  value       = google_cloud_run_v2_service.this.name
  description = "Cloud Run service name"
}

output "service_account_email" {
  value       = local.service_account_email
  description = "Runtime service account email"
}

output "invoker_members" {
  value       = sort(tolist(local.invoker_members))
  description = "IAM members allowed to invoke the service"
}

output "secret_env_names" {
  value       = sort(keys(var.secret_env))
  description = "Env vars resolved from Secret Manager"
}
