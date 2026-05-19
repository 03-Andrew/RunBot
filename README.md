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
```

Terraform uses the standard AWS provider credential chain. Export credentials before applying:

```bash
export AWS_ACCESS_KEY_ID=YOUR_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET
export AWS_REGION=ap-southeast-1
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
