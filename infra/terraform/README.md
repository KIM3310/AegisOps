# AegisOps Terraform

Minimal Cloud Run deployment skeleton for `AegisOps`.

## Apply

```bash
terraform init
terraform apply \
  -var="project_id=your-project" \
  -var="image=asia-northeast3-docker.pkg.dev/your-project/apps/aegisops:latest"
```

Use `env` for runtime configuration such as `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AEGISOPS_OPERATOR_TOKEN`.
