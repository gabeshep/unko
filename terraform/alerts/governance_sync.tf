# Shadow-mode CloudWatch log group — receives all alert firings during 48-hour validation period.
# When shadow_mode = true (default), alerts are logged here instead of paging on-call engineers.
resource "aws_cloudwatch_log_group" "governance_sync_drop_shadow" {
  count             = var.shadow_mode ? 1 : 0
  name              = "/governance-sync-drop-shadow"
  retention_in_days = 7

  tags = {
    Purpose = "governance-sync-drop-shadow-mode"
    Team    = "sre-release-engineering"
  }
}

# CloudWatch metric filter to surface GovernanceSyncDrop alert events in shadow mode.
resource "aws_cloudwatch_log_metric_filter" "governance_sync_drop_shadow" {
  count          = var.shadow_mode ? 1 : 0
  name           = "GovernanceSyncDropShadow"
  pattern        = "{ $.alertname = \"GovernanceSyncDrop\" }"
  log_group_name = aws_cloudwatch_log_group.governance_sync_drop_shadow[0].name

  metric_transformation {
    name      = "GovernanceSyncDropCount"
    namespace = "GovernanceSync/Alerts"
    value     = "1"
  }
}

# Live PagerDuty routing — only provisioned when shadow_mode = false.
# IMPORTANT: Do NOT set shadow_mode = false until 48 hours of shadow-mode validation
# has been completed manually by SRE.
resource "aws_sns_topic" "governance_sync_drop_sre" {
  count = var.shadow_mode ? 0 : 1
  name  = "governance-sync-drop-sre"

  tags = {
    Team = "sre"
  }
}

resource "aws_sns_topic_subscription" "governance_sync_drop_sre_pagerduty" {
  count     = var.shadow_mode ? 0 : 1
  topic_arn = aws_sns_topic.governance_sync_drop_sre[0].arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.sre_pagerduty_service_key}/enqueue"
}

resource "aws_sns_topic" "governance_sync_drop_release_eng" {
  count = var.shadow_mode ? 0 : 1
  name  = "governance-sync-drop-release-eng"

  tags = {
    Team = "release-engineering"
  }
}

resource "aws_sns_topic_subscription" "governance_sync_drop_release_eng_pagerduty" {
  count     = var.shadow_mode ? 0 : 1
  topic_arn = aws_sns_topic.governance_sync_drop_release_eng[0].arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.release_eng_pagerduty_service_key}/enqueue"
}

# CloudWatch Metric Alarm for GovernanceSyncDrop — routes to SNS topics based on shadow_mode.
# In shadow mode: fires to the shadow log group metric.
# In live mode: fires to PagerDuty SNS topics.
resource "aws_cloudwatch_metric_alarm" "governance_sync_drop" {
  alarm_name          = "GovernanceSyncDrop"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "GovernanceSyncDropCount"
  namespace           = "GovernanceSync/Alerts"
  period              = 180  # 3 minutes — matches Prometheus `for: 3m`
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "DB pending approvals diverges from queue API count for more than 3 minutes."
  treat_missing_data  = "notBreaching"

  alarm_actions = var.shadow_mode ? [] : [
    aws_sns_topic.governance_sync_drop_sre[0].arn,
    aws_sns_topic.governance_sync_drop_release_eng[0].arn,
  ]

  tags = {
    AlertName = "GovernanceSyncDrop"
    Severity  = "critical"
    Team      = "sre-release-engineering"
  }
}
