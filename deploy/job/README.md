# Production batch Job

Runs a keyword batch in `dev-ai` on the `aiapp` pool and delivers every artifact to the private container `maps-keyword-capture` in storage account `fbrdevstorage`. Each file is read back and checked by size and SHA-256 before the manifest calls it verified. For a run that keeps results on the Pod instead, see `deploy/dev-trial/`.

## One-time setup

Requires Contributor on resource group `FBRDev` (to read the account key and create the access policy), Storage Blob Data Contributor on account `fbrdevstorage` (for the `--auth-mode login` commands), and `kubectl` access to `dev-ai`. The SAS is container-scoped and tied to a stored access policy, so it can be revoked without rotating the account key. Never paste the SAS into a terminal, a chat, or a commit.

The account key goes through the `AZURE_STORAGE_KEY` environment variable, which `az storage` reads, so it never appears on a command line.

```bash
az storage container create --account-name fbrdevstorage --name maps-keyword-capture --public-access off --auth-mode login
export AZURE_STORAGE_KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv)
EXPIRY=$(date -u -v+1y +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d '+1 year' +%Y-%m-%dT%H:%MZ)
az storage container policy create --account-name fbrdevstorage \
  --container-name maps-keyword-capture --name maps-capture-writer --permissions rcw --expiry "$EXPIRY"
SAS=$(az storage container generate-sas --account-name fbrdevstorage \
  --name maps-keyword-capture --policy-name maps-capture-writer --https-only -o tsv)
[ -n "$SAS" ] || { echo "SAS generation failed"; exit 1; }
ENV_FILE=$(mktemp); chmod 600 "$ENV_FILE"
printf 'AZURE_STORAGE_CONTAINER_SAS_URL=https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?%s\n' "$SAS" > "$ENV_FILE"
kubectl -n dev-ai create secret generic maps-keyword-capture-storage --from-env-file="$ENV_FILE"
rm -f "$ENV_FILE"; unset AZURE_STORAGE_KEY SAS
```

Check the container is private: `az storage container show --account-name fbrdevstorage --name maps-keyword-capture --auth-mode login --query properties.publicAccess` must print nothing (`null`).

## Build and pin the image

```bash
SHA=$(git rev-parse --short HEAD)
az acr build --registry FBRDevAcr --platform linux/amd64 \
  --image ai/maps-keyword-capture:$SHA --build-arg GIT_COMMIT=$SHA .
```

Put the printed digest into `job.yaml` in both `image` and `IMAGE_DIGEST`, and commit.

## Run a batch

Edit the keywords in `configmap.yaml` (at most 20), then:

```bash
kubectl apply -f deploy/job/configmap.yaml
JOB=$(kubectl create -f deploy/job/job.yaml -o name)
kubectl -n dev-ai logs -f "$JOB"
```

The last log line is a JSON summary with `remotePersistence` (`verified` or `failed`) and `manifestReceipt.objectKey`. Exit code 0 means every keyword was captured and every artifact verified; 2 means some keywords were partial, blocked, or skipped but everything collected was delivered; 1 means a delivery failure or a failed batch.

## Inspect results

```bash
PREFIX=<manifestReceipt.objectKey without manifest.json>     # e.g. 2026-09-18/run_.../att_.../
az storage blob list --account-name fbrdevstorage --container-name maps-keyword-capture --auth-mode login --prefix "$PREFIX" --query "[].name" -o tsv
mkdir -p outputs/azure
az storage blob download-batch --account-name fbrdevstorage --source maps-keyword-capture --auth-mode login --pattern "${PREFIX}*" --destination outputs/azure
```

## Stop, revoke, rotate

- Stop a running batch: `kubectl -n dev-ai delete "$JOB"`. The Pod receives SIGTERM, stops the current keyword at its next round, skips the rest, and uploads the manifest within the 120-second grace period. The worst case is about 90 s with a stalled storage account. Storage cannot stall that shutdown indefinitely: each blob call is aborted on the client after 15 s (the SDK's `tryTimeoutInMs` is only the server-side operation timeout), uploads stop after two consecutive failures, and the final manifest still gets one bounded attempt. Deleting the Job also deletes the Pod and its log, which holds the summary line with `manifestReceipt`. Save the log first: `kubectl -n dev-ai logs "$JOB" > outputs/<runId>.log`.
- Revoke the SAS immediately. Read the key again first, since setup unsets it: `export AZURE_STORAGE_KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv)`, then `az storage container policy delete --account-name fbrdevstorage --container-name maps-keyword-capture --name maps-capture-writer`, then `unset AZURE_STORAGE_KEY`.
- Extend it, with `AZURE_STORAGE_KEY` exported as above: `az storage container policy update --account-name fbrdevstorage --container-name maps-keyword-capture --name maps-capture-writer --expiry <YYYY-MM-DDTHH:MMZ>`. The Secret does not change.
- After an account-key rotation, the SAS signed with the old key stops working, so regenerate the Secret:

  ```bash
  export AZURE_STORAGE_KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv)
  SAS=$(az storage container generate-sas --account-name fbrdevstorage \
    --name maps-keyword-capture --policy-name maps-capture-writer --https-only -o tsv)
  [ -n "$SAS" ] || { echo "SAS generation failed"; exit 1; }
  ENV_FILE=$(mktemp); chmod 600 "$ENV_FILE"
  printf 'AZURE_STORAGE_CONTAINER_SAS_URL=https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?%s\n' "$SAS" > "$ENV_FILE"
  kubectl -n dev-ai create secret generic maps-keyword-capture-storage --from-env-file="$ENV_FILE" --dry-run=client -o yaml | kubectl apply -f -
  rm -f "$ENV_FILE"; unset AZURE_STORAGE_KEY SAS
  ```

  Pods read the Secret at start, so the new SAS applies to the next Job.
