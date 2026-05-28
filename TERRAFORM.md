# Terraform Overview

This repo uses Terraform to provision the AWS infrastructure for the RunBot backend.

## 1. Lambda Packaging

Terraform starts by packaging the built Lambda bundle:

- `archive_file.health_zip` zips `../lambdas/health/dist`
- `archive_file.ai_zip` zips `../lambdas/aiAnalysis/dist`
- The resulting zip is deployed to Lambda

That means you must build the TypeScript code before running `terraform apply`.

## 2. Remote State

The root stack uses an S3 backend in `backend.tf`:

- state bucket: `runbot-terraform-state`
- state key: `activitybot/terraform.tfstate`
- locking: S3 lockfile via `use_lockfile = true`

Because the backend bucket must exist before the root stack can use it, there is a separate bootstrap stack:

- `infrastructure/bootstrap/main.tf`
- it creates the bucket used for Terraform state

Recommended first-time flow:

1. `terraform -chdir=infrastructure/bootstrap init`
2. `terraform -chdir=infrastructure/bootstrap apply`
3. `terraform -chdir=infrastructure init -migrate-state`
4. import any already-existing AWS resources
5. `terraform -chdir=infrastructure apply`

## 3. Shared IAM Role

Terraform creates one IAM role for the Lambda functions:

- `aws_iam_role.lambda_role`
- `aws_iam_role_policy_attachment.basic`

This role gives Lambda permission to write CloudWatch logs.

## 4. SQS Retry Flow

Terraform now adds SQS for webhook retries:

- `aws_sqs_queue.strava_webhook_dlq`
- `aws_sqs_queue.strava_webhook_queue`

Queue settings:

- `visibility_timeout_seconds = 90`
- `maxReceiveCount = 5`
- messages that fail too many times move to the DLQ

This is what makes retry handling work for transient failures and cold starts.

## 5. HTTP Lambda

Terraform keeps the original HTTP Lambda:

- `aws_lambda_function.health`
- `aws_lambda_function.ai_worker`

This Lambda handles:

- `GET /health`
- `POST /discord-interactions`
- `GET /strava/callback`
- `GET /strava/webhook`
- `POST /strava/webhook`
- `POST /ai-coach`

For `/strava/webhook`, it now only validates the request and sends a job to SQS.
For `/discord-interactions`, `/stats`, `/club-activities`, and `/analyse run` now enqueue a job in SQS and return a deferred interaction response.

## 6. Worker Lambda

Terraform adds a second Lambda:

- `aws_lambda_function.strava_worker`

This Lambda processes the queued webhook job:

- looks up the linked Discord user
- fetches the Strava activity
- stores activity data in DynamoDB
- posts the Discord notification

It also processes deferred Discord slash commands:

- looks up the linked Strava user
- fetches weekly stats or club activities
- fetches recent and historical runs for `/analyse run`
- posts the final result back through Discord's interaction follow-up webhook

## 7. API Gateway Routes

Terraform creates an HTTP API Gateway and routes them to the HTTP Lambda:

- `aws_apigatewayv2_api.api`
- `aws_apigatewayv2_integration.health`
- `aws_apigatewayv2_route.health`
- `aws_apigatewayv2_route.discord`
- `aws_apigatewayv2_route.strava_callback`
- `aws_apigatewayv2_route.strava_verify`
- `aws_apigatewayv2_route.strava_event`
- `aws_apigatewayv2_route.ai_coach`

API Gateway still talks to the same HTTP Lambda, so the public API shape does not change.

## 8. CI/CD

The GitHub Actions workflow:

- installs Lambda dependencies
- runs `npx tsc` in `lambdas/health`
- builds the Lambda bundle
- registers Discord commands
- runs `terraform init -input=false`
- runs `terraform apply -auto-approve -input=false`

It expects the required secrets to be provided as `TF_VAR_*` environment variables and AWS credentials to be present in GitHub Secrets.

## 9. SQS Event Source Mapping

Terraform connects the queue to the worker Lambda:

- `aws_lambda_event_source_mapping.strava_webhook_queue`

This tells AWS to:

- read messages from the SQS queue
- invoke the worker Lambda
- retry automatically on failures

## 10. IAM Permissions

Terraform grants the Lambda role the required permissions:

- DynamoDB read/write for the `ActivityBot` table
- `sqs:SendMessage` for the webhook producer
- `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `sqs:GetQueueUrl` for the SQS consumer

## Result

The final flow is:

1. Strava sends a webhook to `/strava/webhook`
2. The HTTP Lambda validates it and enqueues a message in SQS
3. The worker Lambda consumes the message
4. The worker fetches the activity, stores it, and posts to Discord
5. If the worker fails, SQS retries it
6. If it keeps failing, the message ends up in the DLQ

## Note

The two Lambda functions currently share one IAM role. That is fine for now, but if you want tighter least-privilege access later, split them into separate roles.
