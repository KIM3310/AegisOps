variable "project_id" {
  type        = string
  description = "Google Cloud project id"
}

variable "region" {
  type        = string
  description = "Cloud Run region"
  default     = "asia-northeast3"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name"
  default     = "aegisops"
}

variable "image" {
  type        = string
  description = "Container image URL"
}

variable "env" {
  type        = map(string)
  description = "Runtime environment variables"
  default     = {}
}

variable "secret_env" {
  type = map(object({
    secret  = string
    version = string
  }))
  description = "Secret Manager-backed env vars keyed by env name."
  default     = {}
}

variable "labels" {
  type        = map(string)
  description = "Cloud Run service labels."
  default     = {}
}

variable "enable_required_services" {
  type        = bool
  description = "Enable required Google APIs for the deployment."
  default     = true
}

variable "create_service_account" {
  type        = bool
  description = "Create a dedicated runtime service account."
  default     = true
}

variable "service_account_id" {
  type        = string
  description = "Service account id used when create_service_account is true."
  default     = "aegisops-runtime"
}

variable "service_account_email" {
  type        = string
  description = "Existing runtime service account email when create_service_account is false."
  default     = ""
}

variable "allow_unauthenticated" {
  type        = bool
  description = "Allow unauthenticated Cloud Run invocations."
  default     = true
}

variable "invoker_members" {
  type        = set(string)
  description = "Additional IAM members allowed to invoke the service."
  default     = []
}

variable "min_instance_count" {
  type        = number
  description = "Minimum Cloud Run instances."
  default     = 0
}

variable "max_instance_count" {
  type        = number
  description = "Maximum Cloud Run instances."
  default     = 3
}

variable "container_port" {
  type        = number
  description = "Container listen port."
  default     = 8080
}

variable "cpu" {
  type        = string
  description = "Container CPU limit."
  default     = "1"
}

variable "memory" {
  type        = string
  description = "Container memory limit."
  default     = "512Mi"
}

variable "timeout_seconds" {
  type        = number
  description = "Cloud Run request timeout in seconds."
  default     = 300
}

variable "health_check_path" {
  type        = string
  description = "Liveness probe path."
  default     = "/api/healthz"
}

variable "startup_probe_path" {
  type        = string
  description = "Startup probe path."
  default     = "/api/healthz"
}
