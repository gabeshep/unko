# Shadow-mode CloudWatch log group for break-glass security events during 48-hour validation.
# When shadow_mode = true (default), invocations are logged here instead of paging security on-call.
resource "aws_cloudwatch_log_group" "break_glass_shadow" {
  count             = var.shadow_mode ? 1 : 0
  name              = "/break-glass-shadow"
  retention_in_days = 30

  tags = {
    Purpose = "break-glass-shadow-mode"
    Team    = "security"
  }
}

# Live SNS topic for break-glass security alerts — only provisioned when shadow_mode = false.
# IMPORTANT: Do NOT set shadow_mode = false until placeholder keys in authorized-keys.json
# have been replaced with real Ed25519 public keys and 48 hours of shadow-mode validation pass.
resource "aws_sns_topic" "break_glass_security_alert" {
  count = var.shadow_mode ? 0 : 1
  name  = "break-glass-security-alert"

  tags = {
    Team = "security"
  }
}

resource "aws_sns_topic_subscription" "break_glass_security_pagerduty" {
  count     = var.shadow_mode ? 0 : 1
  topic_arn = aws_sns_topic.break_glass_security_alert[0].arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.security_pagerduty_service_key}/enqueue"
}

# CloudWatch Metric Alarm for break-glass invocations.
# In shadow mode: no alarm_actions (events visible in CloudWatch metrics only).
# In live mode: fires to PagerDuty Security SNS topic.
resource "aws_cloudwatch_metric_alarm" "break_glass_triggered" {
  alarm_name          = "BreakGlassTriggered"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BreakGlassInvocationCount"
  namespace           = "BreakGlass/Security"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "A break-glass deployment bypass was invoked."
  treat_missing_data  = "notBreaching"

  alarm_actions = var.shadow_mode ? [] : [
    aws_sns_topic.break_glass_security_alert[0].arn,
  ]

  tags = {
    AlertName = "BreakGlassTriggered"
    Severity  = "critical"
    Team      = "security"
  }
}
