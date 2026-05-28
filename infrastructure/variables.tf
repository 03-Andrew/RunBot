variable "discord_public_key" {
  description = "Discord application public key used to verify interaction request signatures."
  type        = string
  sensitive   = true
}

variable "strava_client_id" {
  type = string
}

variable "strava_client_secret" {
  type = string
}

variable "verify_token" {
  type      = string
  sensitive = true
}

variable "discord_bot_token" {
  type      = string
  sensitive = true
}

variable "discord_application_id" {
  type = string
}

variable "discord_channel_id" {
  type = string
}

variable "ai_coach_token" {
  type      = string
  sensitive = true
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
}
