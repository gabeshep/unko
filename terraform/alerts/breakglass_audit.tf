# CloudWatch log group for break-glass deployment audit trail.
# retention_in_days = 0 means logs never expire — enforcing immutability.
resource "aws_cloudwatch_log_group" "breakglass_audit" {
  name              = "/breakglass/audit-log"
  retention_in_days = 0

  tags = {
    Team    = "sre-release-engineering"
    Purpose = "break-glass-audit"
  }
}

# IAM policy granting append-only access to the break-glass audit log.
# Explicitly excludes delete and retention-modification actions to enforce immutability.
resource "aws_iam_policy" "breakglass_audit_writer" {
  name        = "breakglass-audit-writer"
  description = "Allows the break-glass CI role to write audit log entries. No delete or retention-modification permissions."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AppendOnlyAuditLog"
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents",
          "logs:CreateLogStream",
        ]
        Resource = "${aws_cloudwatch_log_group.breakglass_audit.arn}:*"
      }
    ]
  })
}

# CloudWatch metric filter counting break-glass deployment events.
resource "aws_cloudwatch_log_metric_filter" "breakglass_deploy_count" {
  name           = "BreakglassDeployCount"
  pattern        = "{ $.event = \"breakglass_deploy\" }"
  log_group_name = aws_cloudwatch_log_group.breakglass_audit.name

  metric_transformation {
    name      = "BreakglassDeployCount"
    namespace = "BreakGlass/Audit"
    value     = "1"
  }
}

# CloudWatch alarm that fires when break-glass deployments exceed 3 in any 7-day rolling window.
# Routes to the SRE SNS topic when shadow_mode = false, triggering a postmortem review.
resource "aws_cloudwatch_metric_alarm" "breakglass_deploy_frequency" {
  alarm_name          = "BreakglassDeployFrequency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BreakglassDeployCount"
  namespace           = "BreakGlass/Audit"
  period              = 604800  # 7-day rolling window
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "More than 3 break-glass deployments in a 7-day window. SRE postmortem review required."
  treat_missing_data  = "notBreaching"

  alarm_actions = var.shadow_mode ? [] : [
    aws_sns_topic.governance_sync_drop_sre[0].arn,
  ]

  tags = {
    AlertName = "BreakglassDeployFrequency"
    Severity  = "high"
    Team      = "sre-release-engineering"
  }
}
