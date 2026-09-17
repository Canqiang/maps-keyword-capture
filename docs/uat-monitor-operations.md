# UAT daily keyword monitor

This workload reads fresh UAT keyword records for the seven explicitly enrolled stores in `deploy/uat-monitor/configmap.yaml`. It runs at **00:00 Asia/Shanghai** using `0 0 * * *`. This document and the suspended manifests do not prove deployment, successful capture, or activation. Only enable the schedule after the release owner has completed the manual acceptance and independent Azure verification below.

The source is `GET http://operation-assistant-api.uat.svc.cluster.local:80/seo/keyword/local/{place_id}`. Each cycle validates the merchant and Place ID, selects up to 40 distinct words by P0–P3 priority and stable source order, and splits them into batches of at most 20. Query text remains unchanged. Empty surface tags do not remove local keywords. An API failure or identity mismatch must be recorded as a source failure, never as a successful empty list. The API currently omits the record update timestamp: snapshots record `updatedTime: null`, fetch time, record ID, and source hash rather than inventing a timestamp.

Google Maps searches use only the query, with no coordinate or browser location override. The profile remains `en-US`, browser timezone `America/New_York`, viewport 1440×1000, and up to 15 displayed listings. Dates and filenames use Beijing time. Display position, organic rank and ads remain separate. Absence in the observed first 15 is not rank 16. Own-store summaries require matching canonical business IDs; name-only guesses remain `identity_unresolved`.

## Enrollment and capacity

The registry comes from the read-only inventory captured at `2026-09-17T13:21:50.308Z`. Seven records have both merchant and Place IDs, covering six merchants and seven places. Names below preserve the stored labels and do not assert canonical business identity.

| Store ID | Stored name | Inventory words | Capped queries / batches |
| --- | --- | ---: | ---: |
| choice-upper-west-side | Choice Brooklyn - Upper West Side | 101 | 40 / 2 |
| choice-clinton-hill | Choice Market - Clinton Hill | 101 | 40 / 2 |
| only-bear | Only Bear Chicken & Boba | 65 | 40 / 2 |
| keke-flushing | Keke Food 可可小卤 — Flushing | 91 | 40 / 2 |
| george-merchant | George Merchant | 91 | 40 / 2 |
| massage-float | Massage & float | 51 | 40 / 2 |
| szechuan-gourmet | Szechuan Gourmet 朵颐食府 | 20 | 20 / 1 |

The 260 queries / 13 batches are an inventory estimate; the actual daily source snapshot governs coverage. The five excluded legacy records lack both identity links: Mr Keke Asian Cuisine (`019f0280-228b-7296-82e7-7141b7d68ae6`), Andrews NYC Diner (`019f0373-f80f-77a9-a6a6-b39aef4119a7`), two Black Hand Coffee Co. records (`019f03c9-e920-779e-956c-06303369e1e3`, `019f039b-879b-797e-aa92-de67ef2d0054`), and Mr KeKe Great Neck Plaza (`019f01fa-fb48-7d59-b9cf-b2eaf0bf2363`). Missing IDs are not evidence that records represent duplicate businesses. New stores require explicit registry edits and identity validation; the per-place endpoint is not a store-enumeration API.

## Build and pin before applying

Run commands from the repository root, with the intended AKS context already selected. The snippets run in child Bash processes so failures stop that block without exiting the interactive shell. Build requires ACR permission. Container setup requires access to the `FBRDev` storage account keys and the appropriate Azure data-plane role; the Pod receives only a container-scoped SAS and no Kubernetes API token or new RBAC permissions.

The inherited hardened digest in the initial manifest does **not** contain the monitor CLI. The release owner must build the monitor and update both `image` and `IMAGE_DIGEST` before applying or creating a manual Job. Keep `suspend: true` committed for acceptance. Remove the pending-image comment when the new digest is pinned.

```bash
bash <<'SH'
set -euo pipefail
npm ci
npm run typecheck
npm test
npm run build
MONITOR_COMMIT=$(git rev-parse HEAD)
az acr build --registry FBRDevAcr --platform linux/amd64 \
  --image "ai/maps-keyword-capture:uat-monitor-$MONITOR_COMMIT" \
  --build-arg "GIT_COMMIT=$MONITOR_COMMIT" .
az acr repository show --name FBRDevAcr \
  --image "ai/maps-keyword-capture:uat-monitor-$MONITOR_COMMIT" \
  --query digest -o tsv
SH
```

Use the registry-readback digest, not a mutable tag. Review and commit the pinned manifest, then run `npx vitest run tests/uat-monitor-deploy.test.ts`. Confirm the built image contains `dist/monitor/cli.js` as part of image acceptance.

## Create isolated storage and Secret

The private container is `fbrdevstorage/maps-keyword-capture-uat`; Dev uses a different container. `AZURE_STORAGE_CONTAINER` documents the intended target, but a SAS URL directly chooses its container, so verify the Secret value against the newly generated URL. Never print account keys, SAS values, Secret YAML/JSON, or browser environments. Do not run this block with shell tracing, Azure `--debug`, or transcript tooling that records environment values.

Release metadata: the UAT container and Secret have been created and the Secret value independently read back by the release owner. The live stored policy is `maps-uat-monitor-writer`, expiring at `2027-09-17T13:35Z`. This proves storage provisioning, not monitor capture acceptance or schedule activation. The 90-day expiry calculation below is an example for a new policy, not the current live expiry.

This first-time setup intentionally uses `create`, which refuses to overwrite an existing Secret. It uses an expiring, container-scoped stored access policy with read/create/write permission and no delete permission. The account key is passed through an environment variable; credentials and generated Secret manifests are never command-line arguments or committed files.

```bash
bash <<'SH'
set +x
set -euo pipefail
umask 077
MONITOR_SECRET_DIR=$(mktemp -d)
trap 'rm -rf "$MONITOR_SECRET_DIR"; unset AZURE_STORAGE_KEY MONITOR_SAS' EXIT
az storage container create --account-name fbrdevstorage \
  --name maps-keyword-capture-uat --public-access off --auth-mode login --only-show-errors -o none
AZURE_STORAGE_KEY=$(az storage account keys list -g FBRDev -n fbrdevstorage --query '[0].value' -o tsv --only-show-errors)
export AZURE_STORAGE_KEY
test -n "$AZURE_STORAGE_KEY"
MONITOR_EXPIRY=$(python3 -c 'from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(days=90)).strftime("%Y-%m-%dT%H:%MZ"))')
az storage container policy create --account-name fbrdevstorage \
  --container-name maps-keyword-capture-uat --name maps-uat-monitor-writer \
  --permissions rcw --expiry "$MONITOR_EXPIRY" --only-show-errors -o none
MONITOR_SAS=$(az storage container generate-sas --account-name fbrdevstorage \
  --name maps-keyword-capture-uat --policy-name maps-uat-monitor-writer \
  --https-only --only-show-errors -o tsv)
test -n "$MONITOR_SAS"
printf 'AZURE_STORAGE_CONTAINER_SAS_URL=https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture-uat?%s\n' "$MONITOR_SAS" > "$MONITOR_SECRET_DIR/storage.env"
kubectl -n uat create secret generic maps-keyword-monitor-storage --from-env-file="$MONITOR_SECRET_DIR/storage.env"
python3 - "$MONITOR_SECRET_DIR/storage.env" <<'PY'
import base64, json, subprocess, sys
from pathlib import Path
expected = Path(sys.argv[1]).read_text().strip().split('=', 1)[1]
result = subprocess.run(['kubectl', '-n', 'uat', 'get', 'secret', 'maps-keyword-monitor-storage', '-o', 'json'], check=True, capture_output=True, text=True)
actual = base64.b64decode(json.loads(result.stdout)['data']['AZURE_STORAGE_CONTAINER_SAS_URL']).decode()
if actual != expected:
    raise SystemExit('Secret verification failed; values suppressed')
print('UAT Secret value verified; values suppressed')
PY
unset AZURE_STORAGE_KEY MONITOR_SAS
az storage container show --account-name fbrdevstorage --name maps-keyword-capture-uat \
  --auth-mode login --query properties.publicAccess --only-show-errors -o json
SH
```

The final public-access value must be `null`. Record the policy expiry in the release record and renew it before expiration. Extend the stored policy with `az storage container policy update` using the same account-key capture method; never display the key. Following account-key rotation, generate a new SAS, then replace the Secret using `kubectl create secret ... --dry-run=client -o json | kubectl replace -f -` inside the protected block, and repeat the captured-value comparison. Avoid `kubectl apply` for Secrets because its last-applied annotation duplicates their contents. Existing Pods retain their original environment until restarted.

## Apply suspended and run manual acceptance

Before this block, pin the new image as described above. Apply only the UAT directory, preserving unrelated Dev workloads.

```bash
bash <<'SH'
set -euo pipefail
kubectl apply -f deploy/uat-monitor/configmap.yaml
kubectl apply -f deploy/uat-monitor/cronjob.yaml
kubectl -n uat get cronjob maps-keyword-monitor-daily \
  -o jsonpath='{.spec.schedule}{" "}{.spec.timeZone}{" suspend="}{.spec.suspend}{" image="}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}'
SH
```

Expected: `0 0 * * * Asia/Shanghai suspend=true` with the new digest. A manual acceptance Job uses all seven stores and a unique run-key, leaving the next scheduled daily claim available. Keep the printed Job name and run-key in the acceptance record.

```bash
bash <<'SH'
set -euo pipefail
MONITOR_ACCEPTANCE_ID=$(python3 -c 'from datetime import datetime,timezone; import uuid; print(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")+"-"+uuid.uuid4().hex[:8])')
MONITOR_JOB="maps-monitor-accept-$MONITOR_ACCEPTANCE_ID"
MONITOR_RUN_KEY="acceptance-$MONITOR_ACCEPTANCE_ID"
kubectl -n uat create job "$MONITOR_JOB" --from=cronjob/maps-keyword-monitor-daily --dry-run=client -o json |
  python3 -c 'import json,sys; j=json.load(sys.stdin); j["spec"]["template"]["spec"]["containers"][0]["args"] += ["--run-key",sys.argv[1]]; print(json.dumps(j))' "$MONITOR_RUN_KEY" |
  kubectl create -f -
printf 'Job: %s\nRun key: %s\n' "$MONITOR_JOB" "$MONITOR_RUN_KEY"
kubectl -n uat get job "$MONITOR_JOB"
SH
```

Once the Pod is running, save and follow its logs using the printed Job name: `kubectl -n uat logs -f job/JOB_NAME`. Check pending Pod events if scheduling or startup fails. The Job has no retries, 500m/1Gi requests, 2CPU/2Gi limits and bounded temporary volumes. The application deadline is 14 hours, the outer Job deadline is 51,000 seconds, and graceful termination allows 300 seconds. `Forbid` only prevents overlap among scheduled Jobs of this CronJob; it does not constrain a separate manual Job.

## Acceptance and independent readback

Capture the final JSON log record with `summary: true`, the Pod exit code, source counts, selected counts, attempted/captured/skipped coverage, final daily status, and `manifestReceipt`. Exit 0 means full capture and verified delivery, or an **explicitly labeled duplicate skip**; a duplicate skip is not a successful acceptance cycle. Exit 2 means durably persisted partial coverage. Exit 1 means an operational/storage failure, and 64 means invalid input. A running or Kubernetes-completed Job alone does not prove complete coverage.

With a separate Azure login identity rather than the Pod SAS, download the final daily manifest by the exact object key from its receipt. Then follow its snapshot, store, and batch receipts and verify each downloaded object's size and SHA-256 against the receipt. Repeat through batch manifests to verify JSON, CSV, PNG and observations evidence. The daily manifest itself must match the receipt printed in the final summary. Readback failures or missing final receipts are delivery failures.

Example download, after replacing `MANIFEST_OBJECT_KEY` with the nonsecret object key from the final receipt:

```bash
bash <<'SH'
set -euo pipefail
MONITOR_MANIFEST_KEY='MANIFEST_OBJECT_KEY'
test "$MONITOR_MANIFEST_KEY" != 'MANIFEST_OBJECT_KEY'
mkdir -p outputs/uat-monitor-acceptance
az storage blob download --account-name fbrdevstorage --container-name maps-keyword-capture-uat \
  --auth-mode login --name "$MONITOR_MANIFEST_KEY" \
  --file outputs/uat-monitor-acceptance/daily-manifest.json --only-show-errors -o none
python3 - <<'PY'
import hashlib
from pathlib import Path
p = Path('outputs/uat-monitor-acceptance/daily-manifest.json')
print('bytes:', p.stat().st_size, 'sha256:', hashlib.sha256(p.read_bytes()).hexdigest())
PY
SH
```

Confirm all seven enrolled stores are accounted for, selection snapshots were saved before browser capture, and the actual selected pool determines the denominator. Inspect representative PNGs visually and compare their displayed listings with JSON/CSV rank and ad fields. Check that any block, storage failure or cancellation stops further dispatch and is reported for remaining work. Preserve the acceptance evidence and exact image/source commit. Partial coverage remains partial even if all produced files were delivered.

Only after full functional acceptance, the release owner may enable the UAT daily schedule:

```bash
bash <<'SH'
set -euo pipefail
kubectl -n uat patch cronjob maps-keyword-monitor-daily --type merge -p '{"spec":{"suspend":false}}'
kubectl -n uat get cronjob maps-keyword-monitor-daily \
  -o jsonpath='{.spec.schedule}{" "}{.spec.timeZone}{" suspend="}{.spec.suspend}{" image="}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}'
SH
```

Keep the committed initial manifest suspended as the acceptance default. Reapplying it suspends future scheduling; every later release should repeat acceptance before activation. Unsuspending may trigger a missed run within the 3,600-second starting deadline. Check current Jobs and daily claims before enabling. Production enablement beyond UAT is a separate release and requires its own configuration and acceptance; these manifests target UAT only.

## Failure, claims and retention

An atomic create-if-absent blob at `claims/<run-key>.json` prevents duplicate dispatch for that key across manual and scheduled Jobs. The default key is the current Beijing date. The claim is obtained before source/browser work, and an existing claim returns a clearly labeled duplicate skip. A crashed run remains claimed. Do not delete or overwrite its claim to rerun it, and do not treat a duplicate skip as repaired coverage.

For recovery, first confirm the original Job has terminated and preserve its logs, claim, last checkpoint and failed/partial manifest. Resolve the failure, then use the manual Job block with a new unique recovery run-key and record its relationship to the original cycle. Distinct keys can run concurrently, so avoid starting recovery while another monitor Job is active. A delayed default run uses the actual Beijing date; when recovering an earlier scheduled date, record that intended date explicitly in the operational record rather than implying historical coverage from the new folder name.

To pause future dispatch, patch `suspend: true`; this does not stop a running Job. To stop an active Pod, attach a persistent log stream first, then delete that Pod with its normal 300-second grace. Do not force-delete it: the signal handler needs time to finalize partial artifacts and the daily manifest. With zero Job retries, verify the stopped Job failed without a replacement Pod. Storage failures may prevent a final remote manifest; preserve the logs and any readable checkpoint without claiming delivery.

Azure history is retained. Immutable run/attempt IDs preserve selections and original evidence; recovery never overwrites a historical attempt. Daily manifests live under `<Beijing-date>/daily/<daily-run-id>/manifest.json`, and store/batch paths under `<Beijing-date>/<store-id>/<daily-run-id>/`. Only active progress/checkpoint manifests are mutable. Staging is removed only after verified remote delivery and a persisted daily checkpoint; local-only runs retain local files. Kubernetes keeps seven successful and seven failed scheduled Jobs, which is not an Azure retention policy. No lifecycle deletion or claim expiration is installed by these manifests. Any later retention policy needs an explicit historical-evidence decision.

There is no UI in this rollout. Use stored manifests, preserved logs and independent Azure readback to distinguish source coverage, capture quality, durable delivery and active scheduling.
