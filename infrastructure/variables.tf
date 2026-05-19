variable "discord_public_key" {
  description = "Discord application public key used to verify interaction request signatures."
  type        = string
  sensitive   = true
}
