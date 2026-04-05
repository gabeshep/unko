variable "shadow_mode" {
  description = "When true, route GovernanceSyncDrop alerts to CloudWatch log group only (shadow/logging mode). When false, route to live PagerDuty services."
  type        = bool
  default     = true
}

variable "sre_pagerduty_service_key" {
  description = "PagerDuty integration key for the SRE on-call service."
  type        = string
  sensitive   = true
  default     = ""
}

variable "release_eng_pagerduty_service_key" {
  description = "PagerDuty integration key for the Release Engineering on-call service."
  type        = string
  sensitive   = true
  default     = ""
}

variable "security_pagerduty_service_key" {
  description = "PagerDuty integration key for the Security on-call service."
  type        = string
  sensitive   = true
  default     = ""
}
