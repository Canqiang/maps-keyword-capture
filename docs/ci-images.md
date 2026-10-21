# Remote Web and Android image builds

The selected release path is **GitHub source and checks → Azure ACR remote build → Pod pulls by digest**. It uses the operator's existing authorized Azure login and needs no local Docker daemon or local image build. GitHub-hosted image publication is an optional alternative and remains disabled (`ACR_PUBLISH_ENABLED=false`); there is no outstanding requirement for the user to grant its OIDC identity a role.

`.github/workflows/images.yml` runs the TypeScript checks, all Vitest tests, a production build, Python Android contract tests, and the image-receipt tests on GitHub-hosted Ubuntu runners. Chromium is installed for browser fixture tests. No Android emulator or live Maps collection is required by this workflow.

The browser preflight adjustment passed Linux checks in [GitHub run 39531906632](https://github.com/Canqiang/maps-keyword-capture/actions/runs/39531906632) for commit `10911d11e918ad52864ad62930eaf7a8d0113b54`. The preceding [run 39529999579](https://github.com/Canqiang/maps-keyword-capture/actions/runs/39529999579) had 20 `browser_startup_failed` cases in production sandbox launch paths. `.github/scripts/browser-preflight.mjs` first attempts the actual production sandbox launch and records its stderr. Only if that fails and Ubuntu reports the user-namespace restriction does it load an AppArmor profile for the exact Chromium executable, then retry. It does not disable the browser sandbox or change the global restriction setting. Each later source commit needs its own passing checks; this result is not a deployment or collection verdict.

The workflow runs checks for pushes to `main`, the temporary bootstrap branch `codex/fix-tracking-review-20261020`, and pull requests targeting `main`. Its optional publish jobs also require `ACR_PUBLISH_ENABLED=true`; leave that variable false for the selected Azure build path. Manual dispatch can publish only from those same refs. Pull requests run checks with read-only repository access; they cannot publish. The workflow does not deploy, access MongoDB, alter schedules, or receive Kubernetes credentials.

| Surface | Dockerfile | ACR repository |
| --- | --- | --- |
| Web | `Dockerfile` | `fbrdevacr.azurecr.io/ai/maps-keyword-capture` |
| Android | `deploy/android/Dockerfile` | `fbrdevacr.azurecr.io/ai/maps-keyword-capture-android` |

Both builds receive the full source commit as `GIT_COMMIT`; the optional GitHub publication workflow also supplies an OCI revision label. The ACR commands below record the source archive, build argument, run identity and output digest separately. Android builds pull the existing runtime base by digest `sha256:7691aa8c220d055619ceb0d45c15ca0f2ca434f8b059d9db219ab00bf19c6fc5`; they do not build or download an emulator runtime locally. The Android ignore file includes `deploy/android`, which the Web build's root `.dockerignore` excludes. ACR CLI context packing has different ignore-file selection from Docker BuildKit; use the distinct Android context below.

## Selected path: build a committed source archive in ACR

Start from the reviewed commit in the repository after its checks pass. The archive includes only tracked files at that commit; it cannot silently include uncommitted fixes, untracked `.env` files, or the working directory's unrelated files. Commit intended source changes first. Run the following in Bash. These commands create a temporary **source** directory, not an image, and do not invoke Docker:

```sh
set -e
git diff --quiet
git diff --cached --quiet
build_commit="$(git rev-parse --verify HEAD^{commit})"
build_record_dir="$(mktemp -d "${TMPDIR:-/tmp}/maps-acr-build.XXXXXX")"
mkdir "$build_record_dir/context"
git archive --format=tar "$build_commit" > "$build_record_dir/source.tar"
tar -xf "$build_record_dir/source.tar" -C "$build_record_dir/context"
printf '%s\n' "$build_commit" > "$build_record_dir/source-commit.txt"
shasum -a 256 "$build_record_dir/source.tar" > "$build_record_dir/source-archive.sha256"
```

Keep the source archive/hash and run metadata with the release evidence. `Dockerfile`, `deploy/android/Dockerfile` and `deploy/android/Dockerfile.dockerignore` must be tracked at that commit.

Prepare an isolated Android source context. In Azure CLI 2.75.0, ACR selects the ignore override by the Dockerfile's **basename at the context root**. Passing `--file deploy/android/Dockerfile` therefore uses the root `.dockerignore` and excludes the runtime scripts. Copy the two committed files to distinct root names without changing their bytes:

```sh
cp -R "$build_record_dir/context" "$build_record_dir/android-context"
cp "$build_record_dir/android-context/deploy/android/Dockerfile" \
  "$build_record_dir/android-context/Android.Dockerfile"
cp "$build_record_dir/android-context/deploy/android/Dockerfile.dockerignore" \
  "$build_record_dir/android-context/Android.Dockerfile.dockerignore"
cmp "$build_record_dir/context/deploy/android/Dockerfile" "$build_record_dir/android-context/Android.Dockerfile"
cmp "$build_record_dir/context/deploy/android/Dockerfile.dockerignore" "$build_record_dir/android-context/Android.Dockerfile.dockerignore"
shasum -a 256 "$build_record_dir/android-context/Android.Dockerfile" \
  "$build_record_dir/android-context/Android.Dockerfile.dockerignore" > "$build_record_dir/android-context-overrides.sha256"
```

Submit each build **once** and wait for its own structured terminal response. ACR substitutes its unique run ID into the tag; `GIT_COMMIT` remains the full source commit. This recipe uses `--no-logs`, which waits and returns the run JSON. It deliberately does not use `--no-wait`: Azure CLI 2.75.0's command framework discards that return object, so `--no-wait --query runId` can exit 0 with empty stdout even after a build was queued. An explicit `--file` is resolved against the process working directory, so the function first changes into the matching context.

```sh
build_one() (
  set -e
  build_surface="$1"
  build_context="$2"
  build_file="$3"
  build_repository="$4"
  cd "$build_context"
  if ! az acr build --registry fbrdevacr --platform linux/amd64 \
    --file "$build_file" --build-arg "GIT_COMMIT=$build_commit" \
    --image "$build_repository:sha-$build_commit-{{.Run.ID}}" \
    --no-logs --output json . \
    > "$build_record_dir/$build_surface-build-result.json" \
    2> "$build_record_dir/$build_surface-build.stderr"; then
    printf 'Build command did not complete successfully; inspect %s. Do not enqueue again.\n' \
      "$build_record_dir/$build_surface-build.stderr" >&2
    exit 1
  fi
  python3 - "$build_record_dir/$build_surface-build-result.json" \
    "$build_record_dir/$build_surface-run-id.txt" <<'PY'
import json, pathlib, re, sys
run = json.loads(pathlib.Path(sys.argv[1]).read_text())
run_id = run.get('runId')
if not isinstance(run_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', run_id) or run.get('status') != 'Succeeded':
    raise SystemExit('Missing successful run identity; inspect saved result/stderr before any retry')
pathlib.Path(sys.argv[2]).write_text(run_id + '\n')
print(run_id)
PY
)
web_run="$(build_one web "$build_record_dir/context" Dockerfile ai/maps-keyword-capture)"
android_run="$(build_one android "$build_record_dir/android-context" Android.Dockerfile ai/maps-keyword-capture-android)"
```

If the command is interrupted, fails, or produces empty/invalid JSON, preserve its stdout and stderr and stop. The saved stderr may contain `Queued a build with ID: <id>`; recover only the single ID from that exact invocation and independently inspect it with `az acr task show-run --registry fbrdevacr --run-id <id>`. Never select the latest registry run, which could belong to a concurrent build. If no unambiguous ID can be recovered, investigate the request instead of repeating `az acr build`. For example, the observed `--no-wait` invocation that returned empty stdout had already queued run `ch155f`; it must not be submitted again.

The installed CLI paths were checked directly: `acr/build.py` resolves explicit local Dockerfiles from the current directory, logs the queued ID, and returns a poller for `--no-logs`; `core/commands/__init__.py` suppresses `--no-wait` results; `acr/_archive_utils.py` selects root-level ignore overrides. Offline packing with this installed CLI excluded runtime/OCR files in the original Android invocation and included both with `Android.Dockerfile` plus its root ignore file. No build was enqueued for that packaging check.

Independently check that **both** exact run IDs have status `Succeeded`; a queued/running run or upload receipt is insufficient. Save each terminal run record and compare its output digest to a registry read:

```sh
az acr task show-run --registry fbrdevacr --run-id "$web_run" --output json > "$build_record_dir/web-run.json"
az acr task show-run --registry fbrdevacr --run-id "$android_run" --output json > "$build_record_dir/android-run.json"
test "$(az acr task show-run --registry fbrdevacr --run-id "$web_run" --query status --output tsv)" = Succeeded
test "$(az acr task show-run --registry fbrdevacr --run-id "$android_run" --query status --output tsv)" = Succeeded
web_digest="$(az acr task show-run --registry fbrdevacr --run-id "$web_run" --query 'outputImages[0].digest' --output tsv)"
android_digest="$(az acr task show-run --registry fbrdevacr --run-id "$android_run" --query 'outputImages[0].digest' --output tsv)"
[[ "$web_digest" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$android_digest" =~ ^sha256:[a-f0-9]{64}$ ]]
test "$web_digest" = "$(az acr repository show --name fbrdevacr --image "ai/maps-keyword-capture:sha-$build_commit-$web_run" --query digest --output tsv)"
test "$android_digest" = "$(az acr repository show --name fbrdevacr --image "ai/maps-keyword-capture-android:sha-$build_commit-$android_run" --query digest --output tsv)"
printf 'fbrdevacr.azurecr.io/ai/maps-keyword-capture@%s\n' "$web_digest"
printf 'fbrdevacr.azurecr.io/ai/maps-keyword-capture-android@%s\n' "$android_digest"
```

Use those exact digest references for the selected Pod/Deployment/CronJob images and read back the rollout separately. Retain unique commit/run tags; do not use a moving `latest` tag. Existing collectors, store collections, historical records and schedules are outside this build operation. The private Android base is fetched by ACR itself using its existing registry access; no local image pull is required.

## Optional alternative: GitHub OIDC publication (disabled)

The initial repository audit found no GitHub secrets, variables, or environments. During setup on 2026-10-21, the dedicated Entra application, service principal, and exact-ref federations were created. The current Azure account was denied `Microsoft.Authorization/roleAssignments/write`, so it could not grant registry access. The user selected ACR remote builds instead. Keep `ACR_PUBLISH_ENABLED=false`; the instructions below are retained only if GitHub-hosted publication is explicitly chosen in the future. Checks continue while publication is skipped; a green checks job is not a published image. If this optional route is later enabled, a missing identity variable fails the publish job with the variable's name, without printing its value.

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

After independently verifying the role assignment, enable publication. The bootstrap branch's initial push starts a run even before the workflow is merged into `main`; rerun that run after access is granted:

```sh
gh variable set ACR_PUBLISH_ENABLED --body true --repo Canqiang/maps-keyword-capture
gh run rerun <bootstrap-run-id> --repo Canqiang/maps-keyword-capture
```

GitHub requires a workflow to exist on the default branch before [manual dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) is available. After merging, `gh workflow run images.yml --repo Canqiang/maps-keyword-capture --ref main` can start an additional run. Do not depend on manual dispatch for the first feature-branch test.

No client secret or registry password is needed. Do not attach a GitHub environment to the publish job without redesigning the Azure trust: an environment changes the OIDC subject from an exact ref to an environment identity. The workflow grants `id-token: write` only to the gated publish job. All third-party actions are pinned to full commits, and checkout disables persisted Git credentials. See [Azure's OIDC setup](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

After the bootstrap branch is merged, remove its push trigger, publish condition, workflow test expectation, and Azure federated credential. Keep only `main` publication trust.

## Optional GitHub publication receipts

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
