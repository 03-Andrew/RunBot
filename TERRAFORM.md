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

Terraform creates one IAM role shared across all three Lambda functions (`health`, `strava_worker`, and `ai_worker`):

- `aws_iam_role.lambda_role`
- `aws_iam_role_policy_attachment.basic`

This role gives the Lambdas permission to write CloudWatch logs.

## 4. SQS Retry Flow

Terraform now adds SQS for webhook retries:

- `aws_sqs_queue.strava_webhook_dlq`
- `aws_sqs_queue.strava_webhook_queue`

Queue settings:

- `visibility_timeout_seconds = 90`
- `maxReceiveCount = 5`
- messages that fail too many times move to the DLQ

This is what makes retry handling work for transient failures and cold starts.

## 5. HTTP & AI Lambdas

Terraform provisions the primary entrypoint Lambdas:

- `aws_lambda_function.health` (HTTP Lambda): Handles all standard HTTP endpoints including validation, callback, and initial slash-command reception.
- `aws_lambda_function.ai_worker` (AI Lambda): Dedicated Lambda that runs the Gemini runner-coach agent.

The HTTP Lambda handles:

- `GET /health`
- `POST /discord-interactions` (Slash commands `/strava`, `/stats`, `/club-activities`, `/analyse run`, `/ai`)
- `GET /strava/callback`
- `GET /strava/webhook`
- `POST /strava/webhook`

The AI Lambda handles:

- `POST /ai-coach`

For `/strava/webhook`, the HTTP Lambda only validates the request and immediately sends a job to SQS.
For `/discord-interactions`, heavy commands (`/stats`, `/club-activities`, `/analyse run`, `/ai`) are checked against global rate limits and then enqueued as SQS jobs.

## 6. Worker Lambda

Terraform adds a second Lambda:

- `aws_lambda_function.strava_worker`

This Lambda processes the queued webhook job:

- looks up the linked Discord user
- fetches the Strava activity
- stores activity data in DynamoDB
- updates personal records (PRs) in DynamoDB
- posts the Discord notification

It also processes deferred Discord slash commands:

- looks up the linked Strava user
- fetches weekly stats or club activities
- fetches recent and historical runs for `/analyse run`
- calls the AI Lambda (`POST /ai-coach`) to get coaching analyses for `/analyse run` and `/ai` chat queries
- posts the final result back through Discord's interaction follow-up webhook

## 7. API Gateway Routes

Terraform creates an HTTP API Gateway and routes them to the correct Lambda functions:

- `aws_apigatewayv2_api.api`
- Routes pointing to the HTTP Lambda (`aws_apigatewayv2_integration.health`):
  - `aws_apigatewayv2_route.health` (`GET /health`)
  - `aws_apigatewayv2_route.discord` (`POST /discord-interactions`)
  - `aws_apigatewayv2_route.strava_callback` (`GET /strava/callback`)
  - `aws_apigatewayv2_route.strava_verify` (`GET /strava/webhook`)
  - `aws_apigatewayv2_route.strava_event` (`POST /strava/webhook`)
- Route pointing to the AI Lambda (`aws_apigatewayv2_integration.ai_coach`):
  - `aws_apigatewayv2_route.ai_coach` (`POST /ai-coach`)

API Gateway talks to the appropriate Lambda integrations, routing public endpoints cleanly.

## 8. CI/CD

The GitHub Actions workflow:

- installs dependencies for all Lambdas (both `health` and `aiAnalysis`)
- compiles TypeScript code and builds bundles
- registers Discord slash commands with `scripts/registerCommand.js`
- runs `terraform init` and `terraform apply` against the remote S3 backend

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

- DynamoDB read/write for the `ActivityBot` table and its GSI indexes (`${aws_dynamodb_table.activitybot.arn}/index/*`), allowing users, activity records, personal records, and rate limit items to be retrieved, queried, and updated.
- `sqs:SendMessage` for the HTTP Lambda to queue webhook and slash-command jobs.
- `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `sqs:GetQueueUrl` for the worker Lambda to consume queue messages.

## Result

The final flow is:

1. A Strava webhook or Discord slash command arrives at the HTTP Lambda.
2. The HTTP Lambda validates the request, verifies rate limits (for Discord commands), and enqueues a message in SQS.
3. The worker Lambda consumes the message from SQS.
4. The worker Lambda processes the job:
   - Webhooks: Fetches activity, stores it in DynamoDB, updates pre-computed personal records (PRs), and posts notifications to Discord.
   - Slash commands: Fetches stats/activities, runs AI analysis using the AI Lambda (Gemini API) if needed, and posts follow-up responses back to Discord.
5. SQS handles automatic retries and dead-letter queues (DLQ) for failed worker executions.

## Note

The three Lambda functions currently share one IAM role. That is fine for now, but if you want tighter least-privilege access later, split them into separate roles.
