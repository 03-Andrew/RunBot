################################
# Package Lambda
################################

data "archive_file" "api_zip" {
  type        = "zip"
  source_dir  = "../lambdas/api/dist"
  output_path = "../lambdas/api/function.zip"
}

# Archive file for ai_zip removed.


################################
# IAM Role
################################

resource "aws_iam_role" "api_lambda_role" {
  name = "api-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role" "worker_lambda_role" {
  name = "worker-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_basic" {
  role       = aws_iam_role.api_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "worker_basic" {
  role       = aws_iam_role.worker_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

################################
# SQS
################################

resource "aws_sqs_queue" "strava_webhook_dlq" {
  name                      = "strava-webhook-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "strava_webhook_queue" {
  name                       = "strava-webhook-queue"
  visibility_timeout_seconds = 90

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.strava_webhook_dlq.arn
    maxReceiveCount     = 5
  })
}


################################
# Lambda
################################

resource "aws_lambda_function" "api" {
  function_name    = "api"
  role             = aws_iam_role.api_lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.api_zip.output_path
  source_code_hash = data.archive_file.api_zip.output_base64sha256
  timeout          = 15
  environment {
    variables = {
      DISCORD_PUBLIC_KEY   = var.discord_public_key
      STRAVA_CLIENT_ID     = var.strava_client_id
      STRAVA_CLIENT_SECRET = var.strava_client_secret
      VERIFY_TOKEN         = var.verify_token
      DISCORD_BOT_TOKEN    = var.discord_bot_token
      DISCORD_CHANNEL_ID   = var.discord_channel_id
      SQS_QUEUE_URL        = aws_sqs_queue.strava_webhook_queue.url
    }
  }
  depends_on = [
    aws_iam_role_policy_attachment.api_basic
  ]
}

resource "aws_lambda_function" "strava_worker" {
  function_name    = "strava-worker"
  role             = aws_iam_role.worker_lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "worker.handler"
  filename         = data.archive_file.api_zip.output_path
  source_code_hash = data.archive_file.api_zip.output_base64sha256
  timeout          = 60
  environment {
    variables = {
      STRAVA_CLIENT_ID       = var.strava_client_id
      STRAVA_CLIENT_SECRET   = var.strava_client_secret
      DISCORD_APPLICATION_ID = var.discord_application_id
      DISCORD_BOT_TOKEN      = var.discord_bot_token
      DISCORD_CHANNEL_ID     = var.discord_channel_id
      DEEPSEEK_API_KEY        = var.deepseek_api_key
    }
  }
  depends_on = [
    aws_iam_role_policy_attachment.worker_basic
  ]
}

# ai_worker Lambda resource removed.


################################
# API Gateway HTTP API
################################

resource "aws_apigatewayv2_api" "api" {
  name          = "activitybot-api"
  protocol_type = "HTTP"
}


################################
# Lambda Integration
################################

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# ai_coach API Gateway integration removed.


################################
# Route
################################

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "discord" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /discord-interactions"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# ai_coach API Gateway route removed.

################################
# Strava OAuth Callback
################################

resource "aws_apigatewayv2_route" "strava_callback" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /strava/callback"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}
resource "aws_apigatewayv2_route" "strava_verify" {

  route_key = "GET /strava/webhook"

  api_id = aws_apigatewayv2_api.api.id

  target = "integrations/${aws_apigatewayv2_integration.api.id}"
}


resource "aws_apigatewayv2_route" "strava_event" {
  route_key = "POST /strava/webhook"
  api_id    = aws_apigatewayv2_api.api.id
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

################################
# Default Stage
################################

resource "aws_apigatewayv2_stage" "dev" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}


################################
# Lambda Permission
################################

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowExecution"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ai_api Lambda permission removed.

resource "aws_lambda_event_source_mapping" "strava_webhook_queue" {
  event_source_arn = aws_sqs_queue.strava_webhook_queue.arn
  function_name    = aws_lambda_function.strava_worker.arn
  batch_size       = 1
}

resource "aws_iam_role_policy" "api_dynamo" {
  role = aws_iam_role.api_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ]
      Resource = [
        aws_dynamodb_table.activitybot.arn,
        "${aws_dynamodb_table.activitybot.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "worker_dynamo" {
  role = aws_iam_role.worker_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ]
      Resource = [
        aws_dynamodb_table.activitybot.arn,
        "${aws_dynamodb_table.activitybot.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "sqs_producer" {
  role = aws_iam_role.api_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:SendMessage"
      ]
      Resource = aws_sqs_queue.strava_webhook_queue.arn
    }]
  })
}

resource "aws_iam_role_policy" "api_kms" {
  role = aws_iam_role.api_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kms:Decrypt",
        "kms:CreateGrant"
      ]
      Resource = "arn:aws:kms:ap-southeast-1:942114769797:alias/aws/lambda"
    }]
  })
}

resource "aws_iam_role_policy" "worker_kms" {
  role = aws_iam_role.worker_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kms:Decrypt",
        "kms:CreateGrant"
      ]
      Resource = "arn:aws:kms:ap-southeast-1:942114769797:alias/aws/lambda"
    }]
  })
}

resource "aws_iam_role_policy" "sqs_consumer" {
  role = aws_iam_role.worker_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ]
      Resource = aws_sqs_queue.strava_webhook_queue.arn
    }]
  })
}

################################
# Weekly Recap Lambda + Scheduler
################################

resource "aws_iam_role" "weekly_recap_lambda_role" {
  name = "weekly-recap-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "weekly_recap_basic" {
  role       = aws_iam_role.weekly_recap_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "weekly_recap_dynamo" {
  role = aws_iam_role.weekly_recap_lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        aws_dynamodb_table.activitybot.arn,
        "${aws_dynamodb_table.activitybot.arn}/index/*"
      ]
    }]
  })
}

resource "aws_lambda_function" "weekly_recap" {
  function_name    = "weekly-recap"
  role             = aws_iam_role.weekly_recap_lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "weeklyRecap.handler"
  filename         = data.archive_file.api_zip.output_path
  source_code_hash = data.archive_file.api_zip.output_base64sha256
  timeout          = 180
  environment {
    variables = {
      DISCORD_BOT_TOKEN  = var.discord_bot_token
      DISCORD_CHANNEL_ID = var.discord_channel_id
      DEEPSEEK_API_KEY    = var.deepseek_api_key
    }
  }
  depends_on = [
    aws_iam_role_policy_attachment.weekly_recap_basic
  ]
}

resource "aws_iam_role" "weekly_recap_scheduler_role" {
  name = "weekly-recap-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "weekly_recap_scheduler" {
  role = aws_iam_role.weekly_recap_scheduler_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.weekly_recap.arn
    }]
  })
}

resource "aws_scheduler_schedule" "weekly_recap" {
  name = "weekly-recap"
  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }
  schedule_expression = "cron(0 16 ? * 7 *)"
  target {
    arn      = aws_lambda_function.weekly_recap.arn
    role_arn = aws_iam_role.weekly_recap_scheduler_role.arn
  }
}

resource "aws_lambda_permission" "weekly_recap" {
  statement_id  = "AllowSchedulerInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weekly_recap.function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.weekly_recap.arn
}

################################
# Dynamo DB
################################

resource "aws_dynamodb_table" "activitybot" {

  name = "ActivityBot"

  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name = "GSI1"

    hash_key = "GSI1PK"

    range_key = "GSI1SK"

    projection_type = "ALL"
  }
}
