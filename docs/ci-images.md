# GitHub-built Web and Android images

`.github/workflows/images.yml` runs the TypeScript checks, all Vitest tests, a production build, Python Android contract tests, and the image-receipt tests on GitHub-hosted Ubuntu runners. Chromium is installed for browser fixture tests. No Android emulator or live Maps collection is required by this workflow.

After checks pass and the repository variable `ACR_PUBLISH_ENABLED` is `true`, pushes to `main` or the temporary bootstrap branch `codex/fix-tracking-review-20261020` publish both images to ACR. Manual dispatch can publish only from those same refs. Pull requests run checks with read-only repository access; they cannot publish. The workflow does not deploy, access MongoDB, alter schedules, or receive Kubernetes credentials.

| Surface | Dockerfile | ACR repository |
| --- | --- | --- |
| Web | `Dockerfile` | `fbrdevacr.azurecr.io/ai/maps-keyword-capture` |
| Android | `deploy/android/Dockerfile` | `fbrdevacr.azurecr.io/ai/maps-keyword-capture-android` |

Both builds receive the full source commit as `GIT_COMMIT` and an OCI revision label. Android builds pull the existing runtime base by digest `sha256:7691aa8c220d055619ceb0d45c15ca0f2ca434f8b059d9db219ab00bf19c6fc5`; they do not build or download an emulator runtime locally. The Dockerfile-specific ignore file includes `deploy/android`, which the Web build's root `.dockerignore` excludes.

## One-time Azure OIDC setup

The initial repository audit found no GitHub secrets, variables, or environments. During setup on 2026-10-21, the dedicated Entra application, service principal, and exact-ref federations were created. The current Azure account was denied `Microsoft.Authorization/roleAssignments/write`, so it could not grant registry access. Keep `ACR_PUBLISH_ENABLED=false` until an Azure administrator grants that permission to the publishing identity. Checks continue while publication is skipped; a green checks job is not a published image. After publication is enabled, a missing identity variable fails the publish job with the variable's name, without printing its value.

Use an Entra application/service principal dedicated to image publication. Assign `AcrPush` at the **fbrdevacr registry resource scope only**, with no subscription-wide Contributor role. That permits pulling the private Android base and publishing image metadata. This recipe assumes the registry uses the registry-wide RBAC mode; an ABAC-enabled registry needs equivalent repository-scoped read/write and metadata permissions instead.

Create two federated identity credentials on that identity with:

| Field | Value |
| --- | --- |
| Issuer | `https://token.actions.githubusercontent.com` |
| Audience | `api://AzureADTokenExchange` |
| Main subject | `repo:Canqiang/maps-keyword-capture:ref:refs/heads/main` |
| Temporary bootstrap subject | `repo:Canqiang/maps-keyword-capture:ref:refs/heads/codex/fix-tracking-review-20261020` |

Set these **repository variables**, using the actual IDs of the dedicated identity and Azure tenant/subscription:

```sh
gh variable set AZURE_CLIENT_ID --repo Canqiang/maps-keyword-capture
gh variable set AZURE_TENANT_ID --repo Canqiang/maps-keyword-capture
gh variable set AZURE_SUBSCRIPTION_ID --repo Canqiang/maps-keyword-capture
gh variable set ACR_PUBLISH_ENABLED --body false --repo Canqiang/maps-keyword-capture
```

The created application client ID is `f334be4f-2994-4fa8-90f3-2164f18e1ff5`; its service principal object ID is `47cafe4f-f6bd-4b33-8a05-d4415c00b667`. An administrator with role-assignment permission can grant the required access at the exact registry scope:

```sh
az role assignment create \
  --assignee-object-id 47cafe4f-f6bd-4b33-8a05-d4415c00b667 \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope /subscriptions/b263120d-af69-420b-87b1-6dc7e1c86851/resourceGroups/fbrdev/providers/Microsoft.ContainerRegistry/registries/fbrdevacr
```

After independently verifying the role assignment, enable publication and run the workflow from an allowed branch:

```sh
gh variable set ACR_PUBLISH_ENABLED --body true --repo Canqiang/maps-keyword-capture
gh workflow run images.yml --repo Canqiang/maps-keyword-capture --ref codex/fix-tracking-review-20261020
```

No client secret or registry password is needed. Do not attach a GitHub environment to the publish job without redesigning the Azure trust: an environment changes the OIDC subject from an exact ref to an environment identity. The workflow grants `id-token: write` only to the gated publish job. All third-party actions are pinned to full commits, and checkout disables persisted Git credentials. See [Azure's OIDC setup](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

After the bootstrap branch is merged, remove its push trigger, publish condition, workflow test expectation, and Azure federated credential. Keep only `main` publication trust.

## Image receipts and deployment

Each build publishes a unique `sha-<full-commit>-<run-id>-<attempt>` tag. Rerunning a workflow creates a new tag. The workflow disables writes and deletes on both that tag and its manifest, reads their metadata back from ACR, and verifies their digests against the builder output. [ACR treats tag and manifest locks separately](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-lock).

Successful jobs upload `image-receipt-web` and `image-receipt-android`. Each artifact contains:

- `image.json`: source commit, workflow URL, digest-pinned image reference, registry verification time, and verified attributes.
- `tag.json` and `manifest.json`: independent ACR metadata readback.

The publish job succeeds only after this verification. A failed lock/readback is a failed publication even if the image upload succeeded. A matrix sibling can succeed independently; use only the receipt for the required successful surface.

```sh
gh run list --repo Canqiang/maps-keyword-capture --workflow images.yml
gh run view <run-id> --repo Canqiang/maps-keyword-capture
gh run download <run-id> --repo Canqiang/maps-keyword-capture --name image-receipt-web --dir receipts/web
gh run download <run-id> --repo Canqiang/maps-keyword-capture --name image-receipt-android --dir receipts/android
```

An operator updates a Pod/Deployment/CronJob image to the exact `image` value from the receipt (`repository@sha256:...`). The cluster's existing ACR pull identity remains separate from the publishing identity. A green build proves image publication; deployment rollout and real monitoring evidence require their own readback. A failed or incomplete Actions run is never evidence that Pods have the new source.

Artifacts are retained for 30 days. ACR image locks persist independently; retain needed receipts with deployment evidence. A registry administrator must explicitly unlock a retired tag and manifest before deleting it. The workflow does not remove local Docker images or existing registry releases.

## Local workflow verification

```sh
npm ci
node --test .github/tests/*.test.mjs
```

These tests reject mismatched digests, unlocked or unreadable registry metadata, moving tags, and unexpected image destinations. They also check permission/ref boundaries and pinned action dependencies. They do not simulate Azure token exchange or prove registry authorization; the first remote run supplies that evidence.
