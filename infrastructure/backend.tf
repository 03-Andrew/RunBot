terraform {
  backend "s3" {
    bucket         = "runbot-terraform-state"
    key            = "activitybot/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    use_lockfile   = true
  }
}
