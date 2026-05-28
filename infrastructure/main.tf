################################
# Package Lambda
################################

data "archive_file" "health_zip" {
  type        = "zip"
  source_dir  = "../lambdas/health/dist"
  output_path = "../lambdas/health/function.zip"
}

data "archive_file" "ai_zip" {
  type        = "zip"
  source_dir  = "../lambdas/aiAnalysis/dist"
  output_path = "../lambdas/aiAnalysis/function.zip"
}


################################
# IAM Role
################################

resource "aws_iam_role" "lambda_role" {
  name = "health-lambda-role"
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


resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda_role.name
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

resource "aws_lambda_function" "health" {
  function_name    = "health"
  role             = aws_iam_role.lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.health_zip.output_path
  source_code_hash = data.archive_file.health_zip.output_base64sha256
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
    aws_iam_role_policy_attachment.basic
  ]
}

resource "aws_lambda_function" "strava_worker" {
  function_name    = "strava-worker"
  role             = aws_iam_role.lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "worker.handler"
  filename         = data.archive_file.health_zip.output_path
  source_code_hash = data.archive_file.health_zip.output_base64sha256
  timeout          = 60
  environment {
    variables = {
      STRAVA_CLIENT_ID       = var.strava_client_id
      STRAVA_CLIENT_SECRET   = var.strava_client_secret
      DISCORD_APPLICATION_ID = var.discord_application_id
      DISCORD_BOT_TOKEN      = var.discord_bot_token
      DISCORD_CHANNEL_ID     = var.discord_channel_id
      AI_COACH_URL           = "${aws_apigatewayv2_stage.dev.invoke_url}/ai-coach"
      AI_COACH_TOKEN         = var.ai_coach_token
      GEMINI_API_KEY         = var.gemini_api_key
    }
  }
  depends_on = [
    aws_iam_role_policy_attachment.basic
  ]
}

resource "aws_lambda_function" "ai_worker" {
  function_name    = "ai-worker"
  role             = aws_iam_role.lambda_role.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.ai_zip.output_path
  source_code_hash = data.archive_file.ai_zip.output_base64sha256
  timeout          = 60
  environment {
    variables = {
      GEMINI_API_KEY       = var.gemini_api_key
      AI_COACH_TOKEN       = var.ai_coach_token
      STRAVA_CLIENT_ID     = var.strava_client_id
      STRAVA_CLIENT_SECRET = var.strava_client_secret
      DISCORD_BOT_TOKEN    = var.discord_bot_token
      DISCORD_CHANNEL_ID   = var.discord_channel_id
    }
  }
  depends_on = [
    aws_iam_role_policy_attachment.basic
  ]

}


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

resource "aws_apigatewayv2_integration" "health" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.health.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "ai_coach" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai_worker.invoke_arn
  payload_format_version = "2.0"
}


################################
# Route
################################

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "discord" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /discord-interactions"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "ai_coach" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /ai-coach"
  target    = "integrations/${aws_apigatewayv2_integration.ai_coach.id}"
}

################################
# Strava OAuth Callback
################################

resource "aws_apigatewayv2_route" "strava_callback" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /strava/callback"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}
resource "aws_apigatewayv2_route" "strava_verify" {

  route_key = "GET /strava/webhook"

  api_id = aws_apigatewayv2_api.api.id

  target = "integrations/${aws_apigatewayv2_integration.health.id}"
}


resource "aws_apigatewayv2_route" "strava_event" {
  route_key = "POST /strava/webhook"
  api_id    = aws_apigatewayv2_api.api.id
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
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
  function_name = aws_lambda_function.health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ai_api" {
  statement_id  = "AllowExecutionAi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_worker.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_event_source_mapping" "strava_webhook_queue" {
  event_source_arn = aws_sqs_queue.strava_webhook_queue.arn
  function_name    = aws_lambda_function.strava_worker.arn
  batch_size       = 1
}

resource "aws_iam_role_policy" "dynamo" {

  role = aws_iam_role.lambda_role.id

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

resource "aws_iam_role_policy" "ai_dynamo" {
  role = aws_iam_role.lambda_role.id

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
  role = aws_iam_role.lambda_role.id

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

resource "aws_iam_role_policy" "sqs_consumer" {
  role = aws_iam_role.lambda_role.id

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
