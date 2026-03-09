# AegisOps Terraform

Cloud Run deployment scaffold for `AegisOps` with:
- required Google API enablement
- dedicated runtime service account
- Secret Manager env injection
- configurable public/private invoker IAM
- health and startup probes

## Apply

```bash
terraform init
terraform apply \
  -var="project_id=your-project" \
  -var="image=asia-northeast3-docker.pkg.dev/your-project/apps/aegisops:latest" \
  -var='env={
    AEGISOPS_RUNTIME_STORE_PATH="/app/.runtime/aegisops-runtime-events.db"
    AEGISOPS_OPERATOR_ALLOWED_ROLES="incident_commander,sre"
  }' \
  -var='secret_env={
    GOOGLE_CLIENT_ID={secret="google-client-id",version="latest"}
    GOOGLE_CLIENT_SECRET={secret="google-client-secret",version="latest"}
    AEGISOPS_OPERATOR_TOKEN={secret="aegisops-operator-token",version="latest"}
  }'
```

## Common toggles

```bash
-var="allow_unauthenticated=false"
-var='invoker_members=["group:platform-admins@example.com"]'
-var="create_service_account=false"
-var="service_account_email=aegisops-runtime@your-project.iam.gserviceaccount.com"
```

## Notes

- Use `env` for non-secret config and `secret_env` for Secret Manager-backed values.
- When `allow_unauthenticated=false`, add explicit `invoker_members` for reviewers or platform groups.
- The runtime identity gets `roles/secretmanager.secretAccessor` on referenced secrets automatically.
- Container probes default to `/api/healthz`.
