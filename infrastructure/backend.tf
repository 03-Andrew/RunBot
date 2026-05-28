terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "runbot-terraform-state"
    key          = "activitybot/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
