# RunBot

Minimal AWS serverless backend for a Strava + Discord bot.

## Stack

- Node.js + TypeScript
- AWS Lambda
- API Gateway HTTP API
- Terraform

## Environment

Use `.env.example` as the placeholder reference:

```text
AWS_ACCESS_KEY=YOUR_KEY
AWS_SECRET_KEY=YOUR_SECRET
AWS_REGION=ap-southeast-1
TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
```

Terraform uses the standard AWS provider credential chain. Export credentials before applying:

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=ap-southeast-1
export TF_VAR_discord_public_key=YOUR_DISCORD_APP_PUBLIC_KEY
```

## Deploy

```bash
npm --prefix lambdas/health install
npm --prefix lambdas/health run build
cd lambdas/health/dist && zip -r health.zip .
cd infrastructure
terraform init
terraform apply
```

Terraform only creates the Lambda and API Gateway MVP resources. The Lambda zip is built before `terraform apply` and is read from `lambdas/health/dist/health.zip` by default.

## Test

After apply, use the `api_url` Terraform output:

```bash
curl API_URL/health
```

Expected response:

```json
{"status":"ok"}
```

## Discord Interactions

Set the Discord Developer Portal Interactions Endpoint URL to:

```text
API_URL/discord-interactions
```

The Lambda verifies `X-Signature-Ed25519` and `X-Signature-Timestamp` using
the Discord application public key before responding to Discord's PING request.
