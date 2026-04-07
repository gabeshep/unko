variable "canary_enabled" {
  description = "When true, provisions the EventBridge cron rule that triggers the canary. Set to false to disable the cron without destroying the resource definition."
  type        = bool
  default     = true
}

variable "canary_task_arn" {
  description = "ARN of the ECS task definition (or Lambda function ARN) to invoke on each canary cron tick."
  type        = string
  default     = ""
}

variable "canary_cluster_arn" {
  description = "ARN of the ECS cluster where the canary task runs. Only required when using ECS (not Lambda)."
  type        = string
  default     = ""
}

variable "canary_events_role_arn" {
  description = "IAM role ARN that EventBridge assumes to invoke the canary ECS task or Lambda."
  type        = string
  default     = ""
}

variable "places_api_url" {
  description = "Base URL of the places-api-service for canary health checks"
  type        = string
}

variable "places_api_canary_enabled" {
  description = "When true, provisions the EventBridge cron rule that triggers the places-api-service canary. Set to false to disable the cron without destroying the resource definition."
  type        = bool
  default     = true
}

variable "places_api_canary_task_arn" {
  description = "ARN of the ECS task definition (or Lambda function ARN) to invoke on each places-api-service canary cron tick."
  type        = string
  default     = ""
}

variable "places_api_canary_events_role_arn" {
  description = "IAM role ARN that EventBridge assumes to invoke the places-api-service canary ECS task or Lambda."
  type        = string
  default     = ""
}
