# UAT daily keyword monitor

With `storeDiscovery` enabled, this workload discovers the current eligible stores from UAT `seo-integration.local_keywords` at the start of every cycle, then reads their fresh keyword records through the existing per-place API. `deploy/uat-monitor/configmap.yaml` configures discovery; its `stores` entries only preserve historical store IDs and optional reference-area overrides. The scheduled time is **00:00 Asia/Shanghai** using `0 0 * * *`. This document and the suspended manifests do not prove deployment, successful capture, or activation. Only enable the schedule after the release owner has completed the explicitly scoped manual acceptance and independent Azure verification below. Record whether acceptance covered a reduced-cap release smoke or a full-capacity cycle, with the actual discovered denominator. See the [automatic-discovery design](automatic-store-discovery.md) and [September 23 release evidence](../evidence/2026-09-23/automatic-store-discovery/README.md) for the resumed rollout and its exact acceptance boundary.

The source is `GET http://operation-assistant-api.uat.svc.cluster.local:80/seo/keyword/local/{place_id}`. Each cycle validates the merchant and Place ID, selects up to 40 distinct words by P0–P3 priority and stable source order, and splits them into batches of at most 20. Query text remains unchanged. Empty surface tags do not remove local keywords. An API failure or identity mismatch must be recorded as a source failure, never as a successful empty list. The API currently omits the record update timestamp: snapshots record `updatedTime: null`, fetch time, record ID, and source hash rather than inventing a timestamp.

Google Maps searches use only the query, with no coordinate or browser location override. The profile remains `en-US`, browser timezone `America/New_York`, viewport 1440×1000, and up to 15 displayed listings. Dates and filenames use Beijing time. Display position, organic rank and ads remain separate. Absence in the observed first 15 is not rank 16. Own-store summaries require matching canonical business IDs; name-only guesses remain `identity_unresolved`.

The UAT capture budget allows **up to 8 screenshots and 10 scrolls per keyword**. These are ceilings, not targets: collection stops as soon as the verified result prefix has complete screenshot coverage. Tall cards and lazy-loaded results can require more than five images for 15 listings. The 90-second keyword deadline, 50 MiB screenshot budget, full-card visibility checks, and honest partial outcomes remain in force. A listing that was parsed but never fully shown in a saved screenshot still yields incomplete coverage; increasing the limits must not relabel historical partial results. Screenshot/scroll budget changes alone do not require a new collector image or change the standalone/Dev defaults. Parser changes such as the v4 support below require a newly built and verified image.

## Outcome and geography contract

The original v2 detail-page, no-review Bakery and passive geography changes passed targeted six-query UAT acceptance; the [release record](../evidence/2026-09-18/uat-optimization/README.md) preserves that scope. The v3 scrolling, Lodging-only and execution-status corrections passed a separate five-query UAT collector acceptance and were pinned in the daily image; the [repair release](../evidence/2026-09-18/uat-capture-fixes/README.md) records its scope and the unresolved 500m scheduling constraint. Validate these behaviors for each release:

- A recognized place detail page saves its diagnostic screenshot and returns `partial / non_ranking_result` with no invented first-place rank. It continues the keyword/store queue and does not increment the unsupported-layout breaker. A blank or unrecognized page is still unsupported; CAPTCHA/consent, storage failure, and genuine repeated parser failures retain their stop protections.
- The observed `No reviews / Bakery` card is supported without fabricating a rating or address. The bounded category-only fallback also supports Cafe, Coffee shop, Restaurant, Bubble tea store, and Tea house. The separately supported exact name + Lodging format requires a valid Google Maps place link and distinct business name; arbitrary standalone categories remain unknown. Ads and ambiguous label ownership retain their existing conservative treatment.
- `maps-feed-card/v4` adds the observed Apartment vacation-rental format from the September 23 `float` result: a matching distinct name, HTTPS Google Maps place link, exact `Apartment` category, positive `Sleeps`/bedroom/bed counts, `Directions`, and the supported amenity tokens `Pool`, `Hot tub`, `Free parking`, or `Air-conditioned`. Available rendered lines must agree with normalized text. Bare category cards, unknown extra text and unowned ad markers remain unresolved. Owned Sponsored labels retain ad precedence; missing rating, review count and address remain null. Tests reconstruct visible fields from screenshots/observations rather than an archived raw DOM. This support does not establish relevance to a restaurant or its local area.
- Optional `expectedArea` belongs to an enrolled store, with `label`, verified `latitude`/`longitude`, positive `radiusKm`, and a provenance `source`. A shared `capture.expectedArea` is rejected. Use verified store/reference data; do not guess coordinates from store names. The historical aliases have no reference areas configured, and newly derived stores receive none automatically, so their geographic relevance remains `unverified`.
- Assessment is passive: original keywords, search URLs, map view, and browser geolocation behavior are unchanged. It compares observed place coordinates, never the map camera center. JSON records `quality.geographicRelevance` with `matched`, `outside`, `mixed`, or `unverified`, counts, scope, and provenance. Missing or incomplete evidence must not imply a local ranking.
- CSV `geographic_status` repeats the **query-level** assessment on each listing row. It is not a per-listing label. Detail-only results have header-only CSVs; consult JSON and the diagnostic screenshot.

Partial outcomes remain visible in ranking coverage. The new `executionStatus` can be completed when every query was captured or returned a recognized non-ranking page with complete selected-attempt diagnostic, JSON, CSV and observation evidence. Such a remotely verified cycle exits 0 while its ranking `status` may remain partial. Other partial outcomes still exit 2; source failures, empty selections, blocked/skipped work and missing evidence do not qualify for complete execution. `counts.nonRanking` is a subset of `counts.partial`. Do not rewrite historical results or confuse successful observation with a successful ranking. Report attempted coverage, ranked captures, non-ranking details, other partials, skipped work, geographic relevance, and persistence separately.

## Daily discovery and capacity

After the atomic run claim, the monitor reads a bounded Mongo projection, validates the complete roster, and persists `<Beijing-date>/daily/<daily-run-id>/store-registry.json` before any per-store keyword read or browser launch. The daily manifest references this snapshot by size and SHA-256. The roster is frozen for the cycle; a store added after discovery joins the next scheduled cycle. No stale configured-store fallback is allowed.

Eligible records have valid merchant/place identity, a nonempty stored name and a nonempty keyword array. Missing-link legacy records and empty records are excluded with explicit reasons. Duplicate places, conflicting ownership, alias collisions, a failed/incomplete read, and capacity overflow stop dispatch. No `enabled` or `deleted` field exists in the keyword source contract, so this release does not invent such filtering or require a restaurant-location join. A linked record that remains in the keyword library remains eligible; offboarding must remove/empty that record or introduce an explicit future policy.

The seven historical aliases remain stable. New store IDs are derived from the place identity, so a name change does not move historical storage. A known place reassigned to another merchant fails identity validation rather than inheriting the old alias. The per-store API still independently validates merchant/place linkage and selects distinct raw keywords by priority and source order, up to 40.

The UAT safety bounds are 40 eligible stores, 10,000 source records, and a 30-second discovery timeout. Exceeding either capacity bound is an explicit error, never silent truncation. The existing 14-hour application deadline remains; this release does not establish full-capacity throughput for 40 stores. Empty discovery is incomplete execution rather than a successful zero-store run. Discovery errors use `registry_*` reasons and stop before capture.

The manifest records these outcomes in an optional `registry` section. A failed read has a safe error code and unknown roster counts; there is no claim that the configured aliases were searched. A ready registry has actual fetched/eligible/excluded counts and a verified snapshot receipt. An empty registry is explicitly incomplete. `configHash` remains the launch-config hash stored in the claim; the registry's `sourceResponseHash` is separate and covers normalized source identities/exclusions. The snapshot does not retain every field needed to reconstruct that source hash, so independent readback verifies the persisted file receipt rather than claiming to reproduce the original database response.

The source URI is supplied only through the `maps-keyword-monitor-source` Secret, key `KEYWORD_MONGO_URI`; create it from an approved connection configuration using protected stdin/file handling, verify it without printing it, and do not commit its value. The provider issues read queries only, closes its connection after discovery, and removes the URI from the Chromium environment. It does not create indexes or modify source documents. Prefer a scoped read-only Mongo principal where database authentication is enabled; application read-only behavior is not a database authorization guarantee.

### Historical baseline (not the current roster)

The original registry came from the read-only inventory captured at `2026-09-17T13:21:50.308Z`. Seven records have both merchant and Place IDs, covering six merchants and seven places. Names below preserve the stored labels and do not assert canonical business identity.

| Store ID | Stored name | Inventory words | Capped queries / batches |
| --- | --- | ---: | ---: |
| choice-upper-west-side | Choice Brooklyn - Upper West Side | 101 | 40 / 2 |
| choice-clinton-hill | Choice Market - Clinton Hill | 101 | 40 / 2 |
| only-bear | Only Bear Chicken & Boba | 65 | 40 / 2 |
| keke-flushing | Keke Food 可可小卤 — Flushing | 91 | 40 / 2 |
| george-merchant | George Merchant | 91 | 40 / 2 |
| massage-float | Massage & float | 51 | 40 / 2 |
| szechuan-gourmet | Szechuan Gourmet 朵颐食府 | 20 | 20 / 1 |

The 260 queries / 13 batches are an inventory estimate; the actual daily source snapshot governs coverage. The five excluded legacy records lack both identity links: Mr Keke Asian Cuisine (`019f0280-228b-7296-82e7-7141b7d68ae6`), Andrews NYC Diner (`019f0373-f80f-77a9-a6a6-b39aef4119a7`), two Black Hand Coffee Co. records (`019f03c9-e920-779e-956c-06303369e1e3`, `019f039b-879b-797e-aa92-de67ef2d0054`), and Mr KeKe Great Neck Plaza (`019f01fa-fb48-7d59-b9cf-b2eaf0bf2363`). Missing IDs are not evidence that records represent duplicate businesses. With Mongo discovery enabled, new eligible stores no longer require config edits or a collector deployment. The per-place endpoint remains the keyword reader, not a store-enumeration API. On 2026-09-23, live inventory contained 13 records: eight linked stores including SEE JOY 喜聚 (43 keywords), and five unlinked legacy records. This implies up to 300 selected queries in 15 batches for that snapshot, not a permanently fixed denominator.

## Build and pin before applying

Run commands from the repository root, with the intended AKS context already selected. The snippets run in child Bash processes so failures stop that block without exiting the interactive shell. Build requires ACR permission. Container setup requires access to the `FBRDev` storage account keys and the appropriate Azure data-plane role; the Pod receives only a container-scoped SAS and no Kubernetes API token or new RBAC permissions.

Resolve the candidate image from the current `deploy/uat-monitor/cronjob.yaml` and its release record; a committed pin alone does not prove live deployment. The historical [2026-09-18 repair release](../evidence/2026-09-18/uat-capture-fixes/README.md) used runtime commit `3daa349a05b68d7bdbe5fe1dfe6e20a31c7bf942` (ACR build `ch144n`). The first September 23 discovery smoke used a separate v3 image and correctly ended incomplete on an unrecognized Apartment card. The resumed v4 tree passed typecheck, build and 454 tests across 38 files locally; the new image subsequently passed scoped 8-store / 16-query acceptance and independent readback and was promoted on 2026-09-23. See final identities in the [discovery release evidence](../evidence/2026-09-23/automatic-store-discovery/README.md). Update both `image` and `IMAGE_DIGEST` before applying or creating a manual Job, and keep `suspend: true` committed as the acceptance default.

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

## Apply suspended and choose manual acceptance scope

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

Expected: `0 0 * * * Asia/Shanghai suspend=true` with the new digest.

The historical first-release acceptance scope was **two keywords per enrolled store: 14 actual queries across seven stores**. For discovery releases, use two keywords per freshly discovered store and compute the actual denominator (the 2026-09-23 roster implies 16 queries across eight stores). Create a separate temporary acceptance ConfigMap from the production monitor config, change only `maxKeywordsPerStore` to `2`, and point only the manual acceptance Job's config volume at that ConfigMap. Keep `maps-keyword-monitor-config` at the production cap of 40 and leave the CronJob's volume reference unchanged. Use a unique acceptance run-key. Delete the temporary ConfigMap only after the acceptance Job has terminated and its evidence has been independently verified.

This smoke test exercises every discovered source, capture and storage pipeline at the reduced cap. It does **not** validate the full daily keyword volume, sustained staging behavior, or full-cycle coverage. Unit tests cover the 40-to-20 split; those tests do not establish live full-capacity acceptance. Record the exact temporary config, discovered roster, actual query denominator, capture/delivery counts, image digest, Job name, run-key and remote receipts. Report every excluded source record and any incomplete query; do not substitute the historical seven-store estimate.

The following optional command block runs a **full-capacity acceptance cycle** using the unmodified production ConfigMap. It is not the reduced-cap smoke procedure. Use it only when full-capacity acceptance is intended; the current release smoke alone leaves that capacity unproved. Both scopes use the freshly discovered roster and a unique run-key, leaving the next scheduled daily claim available. Keep the printed Job name and run-key in the acceptance record.

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

Capture the final JSON log record with `summary: true`, the Pod exit code, source counts, selected counts, attempted/captured/skipped coverage, final daily status, and `manifestReceipt`. Exit 0 means complete observation execution and verified delivery (including fully evidenced non-ranking pages), or an **explicitly labeled duplicate skip**; a duplicate skip is not a successful acceptance cycle. Exit 2 means incomplete execution or unresolved partial/blocked/skipped/source outcomes. Read `executionStatus` separately from the original ranked-coverage `status` and the non-ranking subset. Exit 1 means an operational/storage failure, and 64 means invalid input. A running or Kubernetes-completed Job alone does not prove complete coverage.

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

Confirm every discovered store is accounted for, verify the registry snapshot receipt in addition to all selection snapshots, and confirm these snapshots were saved before browser capture. The actual roster and selected pool determine the denominator; do not hard-code seven stores or 260 queries in acceptance tooling. Inspect representative PNGs visually and compare their displayed listings with JSON/CSV rank and ad fields. Check that any block, storage failure or cancellation stops further dispatch and is reported for remaining work. Preserve the acceptance evidence and exact image/source commit. Partial coverage remains partial even if all produced files were delivered.

For v4 acceptance, the independent verifier must explicitly accept `maps-feed-card/v4` and validate the registry snapshot against the actual daily roster. A historical helper restricted to v3 will reject the new provenance and must not be treated as proof of a collector failure. Bind the accepted final summary, daily manifest, original Pod exit and imageID, source commit, launch config hash, unique run key and visual samples to the same smoke. In particular, preserve the original `float` classification-unknown evidence and verify the replacement run's selected result instead of rewriting the earlier outcome. A complete reduced-cap smoke permits only the scoped release conclusion; full 300-query execution and the following midnight trigger require their own evidence.

After the selected acceptance scope passes capture and independent delivery verification, the release owner may enable the UAT daily schedule. When the accepted scope is a reduced-cap smoke, record explicitly that the production cap remains 40 per store and full-cycle capacity for the discovered roster has not been validated by that smoke. Do not label the smoke as complete production coverage:

```bash
bash <<'SH'
set -euo pipefail
kubectl -n uat patch cronjob maps-keyword-monitor-daily --type merge -p '{"spec":{"suspend":false}}'
kubectl -n uat get cronjob maps-keyword-monitor-daily \
  -o jsonpath='{.spec.schedule}{" "}{.spec.timeZone}{" suspend="}{.spec.suspend}{" image="}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"\n"}'
SH
```

Keep the committed initial manifest suspended as the acceptance default. Reapplying it suspends future scheduling; every later release should repeat explicitly scoped acceptance before activation. Unsuspending may trigger a missed run within the 3,600-second starting deadline. Check current Jobs and daily claims before enabling. Production enablement beyond UAT is a separate release and requires its own configuration and acceptance; these manifests target UAT only.

## Failure, claims and retention

An atomic create-if-absent blob at `claims/<run-key>.json` prevents duplicate dispatch for that key across manual and scheduled Jobs. The default key is the current Beijing date. The claim is obtained before source/browser work, and an existing claim returns a clearly labeled duplicate skip. A crashed run remains claimed. Do not delete or overwrite its claim to rerun it, and do not treat a duplicate skip as repaired coverage.

For recovery, first confirm the original Job has terminated and preserve its logs, claim, last checkpoint and failed/partial manifest. Resolve the failure, then use the manual Job block with a new unique recovery run-key and record its relationship to the original cycle. Distinct keys can run concurrently, so avoid starting recovery while another monitor Job is active. A delayed default run uses the actual Beijing date; when recovering an earlier scheduled date, record that intended date explicitly in the operational record rather than implying historical coverage from the new folder name.

To pause future dispatch, patch `suspend: true`; this does not stop a running Job. To stop an active Pod, attach a persistent log stream first, then delete that Pod with its normal 300-second grace. Do not force-delete it: the signal handler needs time to finalize partial artifacts and the daily manifest. With zero Job retries, verify the stopped Job failed without a replacement Pod. Storage failures may prevent a final remote manifest; preserve the logs and any readable checkpoint without claiming delivery.

Azure history is retained. Immutable run/attempt IDs preserve selections and original evidence; recovery never overwrites a historical attempt. Daily manifests live under `<Beijing-date>/daily/<daily-run-id>/manifest.json`, and store/batch paths under `<Beijing-date>/<store-id>/<daily-run-id>/`. Only active progress/checkpoint manifests are mutable. Staging is removed only after verified remote delivery and a persisted daily checkpoint; local-only runs retain local files. Kubernetes keeps seven successful and seven failed scheduled Jobs, which is not an Azure retention policy. No lifecycle deletion or claim expiration is installed by these manifests. Any later retention policy needs an explicit historical-evidence decision.

There is no UI in this rollout. Use stored manifests, preserved logs and independent Azure readback to distinguish source coverage, capture quality, durable delivery and active scheduling.

## First UAT release acceptance boundary

The 2026-09-17 release uses an explicit evidence-collection-only activation exception: 14 live queries produced 12 complete captures and 2 accurately preserved partial outcomes. All 116 referenced objects passed independent readback. The original 14/14 complete-capture gate did not pass; the exception and its limits are recorded in the [release evidence](../evidence/2026-09-17/uat-monitor/README.md). At that release, the application returned exit 2 for all partial coverage. The later execution-status contract above distinguishes evidenced non-ranking observations. This is not a blanket waiver for missing evidence, query mismatch, incorrect ranks, CAPTCHA, or storage failure in later releases. At that release, full 260-query capacity was untested. The first scheduled 2026-09-18 cycle later attempted 119 of 260 queries before the old detail-page handling opened the layout breaker; see [validation status](validation-status.md#first-scheduled-uat-cycle--2026-09-18). A subsequent [manual full-capacity verification](../evidence/2026-09-18/uat-full-verification/README.md) attempted all 260 selected queries across all seven stores and 13 batches, with every referenced object independently verified. Results remain partial (231 complete nonempty lists, two explicit no-results pages, 25 non-ranking pages, one scroll-limit case and one unknown-classification case); the Pod and verifier both returned exit 2. This establishes full dispatch and evidence delivery, not complete ranked coverage, customer-local relevance, or acceptance of a future scheduled run.


## Store-level discovery isolation (2026-09-28)

UAT intentionally excludes the George Merchant test place (`ChIJqVId_y1ZwokRjPCG1MQuKmg`) through `storeDiscovery.excludedPlaces`, reason `test_store`. Both duplicate source records are omitted before ownership checks. This is an approved scope exclusion, not a source-data repair. Nil merchant UUIDs are invalid, which also excludes the known placeholder record without inventing a business-name filter. Other linked stores continue to be discovered from the live library each day.

Unconfigured duplicate place records, conflicting owners, or an alias-owner mismatch are quarantined per place. Inspect the durable registry snapshot for affected IDs and reasons; do not select an owner automatically. Other eligible stores still receive fresh keyword reads and captures. `registry.counts.quarantined` counts source records already included in `excluded`, not keywords or unique stores. Unresolved quarantine produces partial/incomplete execution and exit 2; configured exclusions alone allow exit 0. Global database/capacity/alias-configuration/storage failures retain the fail-closed boundary.

A reduced-cap release smoke validates enrollment, source/API identity, browser capture and evidence delivery only for its selected queries. The next full nightly run remains a separate verification boundary.
