# EventBridge (CloudWatch Events) rule — triggers the discord-sync-worker canary every 5 minutes.
# Set canary_enabled = false to pause the cron without destroying the resource.
resource "aws_cloudwatch_event_rule" "canary_cron" {
  count               = var.canary_enabled ? 1 : 0
  name                = "discord-sync-worker-canary"
  description         = "Triggers the discord-sync-worker synthetic canary every 5 minutes to validate the full webhook approval pipeline."
  schedule_expression = "rate(5 minutes)"
  state               = "ENABLED"

  tags = {
    Purpose   = "synthetic-canary"
    Service   = "discord-sync-worker"
    Team      = "sre-release-engineering"
  }
}

# EventBridge target — invokes the canary ECS task (or Lambda) on each cron tick.
resource "aws_cloudwatch_event_target" "canary_cron_target" {
  count     = var.canary_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.canary_cron[0].name
  target_id = "discord-sync-worker-canary-target"
  arn       = var.canary_task_arn
  role_arn  = var.canary_events_role_arn

  # ECS-specific run task parameters — omit if using Lambda ARN in canary_task_arn.
  ecs_target {
    task_definition_arn = var.canary_task_arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      # Subnets and security groups should be provided via a terraform.tfvars or
      # a separate networking module. These are placeholder references.
      subnets          = []
      security_groups  = []
      assign_public_ip = false
    }
  }
}

# EventBridge (CloudWatch Events) rule — triggers the places-api-service canary every 5 minutes.
# Set places_api_canary_enabled = false to pause the cron without destroying the resource.
resource "aws_cloudwatch_event_rule" "places_api_canary" {
  count               = var.places_api_canary_enabled ? 1 : 0
  name                = "places-api-service-canary"
  description         = "Triggers the places-api-service synthetic canary every 5 minutes to validate the places search endpoint."
  schedule_expression = "rate(1 minute)"
  state               = "ENABLED"

  tags = {
    Purpose   = "synthetic-canary"
    Service   = "places-api-service"
    Team      = "sre-release-engineering"
  }
}

# EventBridge target — invokes the canary ECS task on each cron tick.
resource "aws_cloudwatch_event_target" "places_api_canary_target" {
  count     = var.places_api_canary_enabled ? 1 : 0
  rule      = aws_cloudwatch_event_rule.places_api_canary[0].name
  target_id = "places-api-service-canary-target"
  arn       = var.places_api_canary_task_arn
  role_arn  = var.places_api_canary_events_role_arn

  # ECS-specific run task parameters — omit if using Lambda ARN in places_api_canary_task_arn.
  ecs_target {
    task_definition_arn = var.places_api_canary_task_arn
    task_count          = 1
    launch_type         = "FARGATE"

    network_configuration {
      # Subnets and security groups should be provided via a terraform.tfvars or
      # a separate networking module. These are placeholder references.
      subnets          = []
      security_groups  = []
      assign_public_ip = false
    }
  }
}
