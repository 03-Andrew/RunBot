################################
# Package Lambda
################################

data "archive_file" "health_zip" {
  type        = "zip"
  source_dir  = "../lambdas/health/dist"
  output_path = "../lambdas/health/dist/function.zip"
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
# Lambda
################################

resource "aws_lambda_function" "health" {
  function_name    = "health"
  role             = aws_iam_role.lambda_role.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.health_zip.output_path
  source_code_hash = data.archive_file.health_zip.output_base64sha256
  environment {
    variables = {
      DISCORD_PUBLIC_KEY = var.discord_public_key
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
