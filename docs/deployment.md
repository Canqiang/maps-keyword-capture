# Deployment Summary

The complete runtime design is in [Detailed Design](design.md#12-kubernetes-execution). Delivery gates are in [Implementation Plan](implementation-plan.md). The image is built with `az acr build` (see [deploy/job/README.md](../deploy/job/README.md)), the production Job is [deploy/job/job.yaml](../deploy/job/job.yaml), the Dev daily schedule is [deploy/cronjob/cronjob.yaml](../deploy/cronjob/cronjob.yaml), the UAT monitor is [deploy/uat-monitor/cronjob.yaml](../deploy/uat-monitor/cronjob.yaml), and acceptance evidence is in [validation status](validation-status.md).

## Selected approach

Run one independent Kubernetes Job per keyword batch in namespace `dev-ai` of the FBRDev AKS cluster (eastus2). Use an image based on the official Playwright Linux image with its bundled Chromium, one browser, and sequential keyword processing. Publish to `fbrdevacr.azurecr.io/ai/maps-keyword-capture`, schedule on `envpool=aiapp`, and pull through the kubelet identity (no `imagePullSecrets`), matching the existing `dev-ai` workloads. Do not depend on a Core AI Agent session or long-running sandbox lifecycle.

Dev batches run daily from CronJob `maps-capture-daily`, and manual Jobs remain available for other keyword sets. Both create the same batch Pod. The separate [UAT daily keyword monitor](uat-monitor-operations.md) fetches fresh per-store keywords at midnight Beijing time; its [release record](../evidence/2026-09-17/uat-monitor/README.md) distinguishes deployment, evidence verification, partial coverage and activation. A queue and a general run controller with retry or resume remain later work.

The first version uses query-only search: omit `mapView` from the input, submit the original keyword without coordinates or simulated geolocation, and do not pan the map or click "Search this area". Retain the egress context and final URL as metadata. Inspect the returned area for region-bearing keywords on the target Pod; the [local query-only samples](../evidence/2026-09-17/README.md) show that an area name alone does not ensure local results. Record ambiguity for review; do not silently rewrite queries or force the map view if results differ.

## Settings in `deploy/job/job.yaml`

| Setting | Value |
|---|---|
| Browser launch | bundled Chromium with `channel: "chromium"` (new headless mode, not the headless shell), `headless: true`, `chromiumSandbox: true` |
| Job parallelism / completions | 1 / 1 |
| Restart policy / backoff limit | `Never` / 0 |
| CPU request / limit | 500m / 2 (a 1-core request did not schedule on the fixed four-node `aiapp` pool) |
| Memory request / limit | 1Gi / 2Gi |
| Ephemeral storage request / limit | 1Gi / 3Gi |
| Disk-backed work volume | 2Gi maximum |
| Dedicated memory-backed `/dev/shm` | 512Mi |
| Termination grace period | 120 seconds (worst case about 100 s plus the in-flight round with a stalled storage account) |
| Active deadline | 3000 seconds (20 keywords) |
| Finished Job TTL | 24 hours for manual Jobs from this file; Jobs created by any CronJob (scheduled or "立即采集") are deleted with their Pods 10 minutes after they finish |

## Dev schedule in `deploy/cronjob/cronjob.yaml`

| Setting | Value |
|---|---|
| Schedule | `0 10 * * *` in `America/New_York` (10:00 every day) |
| Concurrency policy | `Forbid` (does not count Jobs created by hand) |
| Starting deadline | 3600 seconds |
| Job history | `ttlSecondsAfterFinished: 600`: each Job and its Pods are deleted 10 minutes after finishing, success or failure, so read `kubectl logs` within that window; results and receipts stay in Azure |
| Keywords | ConfigMap `maps-capture-keywords-daily`, separate from the manual Job's `maps-capture-keywords` |

The Job template must match `deploy/job/job.yaml` except for the keyword ConfigMap, an `app.kubernetes.io/instance` label, and the TTL (600 s instead of 24 h); `tests/deploy-manifests.test.ts` enforces this. Operation is described in [deploy/cronjob/README.md](../deploy/cronjob/README.md).

Measured on 2026-09-17 with 20 keywords: 6 min 10 s, peak about 1.1 CPU and 654Mi memory (15-second `kubectl top` samples). Set the application deadline from batch size and per-keyword budgets, with a separate outer Job deadline. Verify Chromium sandbox compatibility rather than silently disabling it. Shared-memory usage counts against the memory budget.

Run as non-root, keep permissions minimal, and mount writable paths required by the tested image. Do not enable privileged mode or host IPC by default. Pin the image digest and record Chromium, adapter, and application versions.

Storage target: private container `maps-keyword-capture` in account `fbrdevstorage` (the `seo` container is publicly readable and is not used). Pods authenticate with a container-scoped SAS tied to stored access policy `maps-capture-writer`, from Secret `maps-keyword-capture-storage`; local runs use `az login` with `AZURE_STORAGE_ACCOUNT_URL`. Setup, run, inspection, and revocation steps are in [deploy/job/README.md](../deploy/job/README.md).

## UAT monitor in `deploy/uat-monitor/cronjob.yaml`

Since 2026-10-22 every CronJob in this repository and the UAT environment repository (`maps-keyword-monitor-daily`, `maps-tracking-web-2h`, `maps-targets-web-2h`, `maps-tracking-ingest-daily`, Dev `maps-capture-daily`) sets `ttlSecondsAfterFinished: 600`, so finished Jobs and their Pods are removed automatically. The history limits no longer retain anything past that window. The tracking UI's recent-scan list therefore only shows runs that finished in the last 10 minutes or are still running.

CronJob `uat/maps-keyword-monitor-daily` runs at `0 0 * * *` in `Asia/Shanghai`. Seven enrolled stores use the latest API records, capped at 40 keywords per store and split into batches of at most 20. The current source selection totals 260 queries. It uses private container `maps-keyword-capture-uat` and Secret `maps-keyword-monitor-storage`, separately from Dev.

The UAT monitor has its own image digest, a 14-hour application deadline, a 51,000-second Job deadline and a 300-second termination grace period. Its committed manifest starts suspended for release acceptance; the verified live release is enabled. Merging source branches does not require reapplying the manifests. Reapplying the suspended UAT manifest pauses future scheduling until the runbook's acceptance and activation steps are repeated. See the [UAT operations guide](uat-monitor-operations.md) and [release evidence](../evidence/2026-09-17/uat-monitor/README.md), including the 12-complete/2-partial smoke result and untested full-volume capacity.

## Delivery and recovery

Persist and independently read back each completed keyword before starting the next. Store immutable artifacts under unique run/worker-attempt/query-attempt prefixes. Record each verified artifact's key, size, checksum, and verification time in the manifest, then upload the manifest and read it back; there is no separate artifact index.

Collection quality and storage verification are separate states. Partial results may be durably saved; a successful process exit alone does not prove complete collection. Do not merge different attempts or automatically choose the attempt showing the best rank.

Use bounded application retries for transient browser errors. Stop on CAPTCHA and mark remaining inputs as skipped. Job-level retries are initially disabled. A crashed Pod may lose its unfinished query, while earlier verified results remain available. Exactly-once execution and automatic Pod-level resume are not promised by the initial version.

## Before deploying

Confirm Chromium sandbox behavior on the `aiapp` nodes and measured resource use. Earlier environment notes reported the namespace, registry, Virginia egress, and storage target on 2026-09-17; recheck operational values before deployment. Recovered laptop probes include Chrome, Chromium, a visible Sponsored card, and three query-only first screens. Target-Pod acceptance evidence is recorded under [Production Job acceptance](validation-status.md#production-job-acceptance-2026-09-17) in the validation status; the archived laptop scripts did not explicitly enable the sandbox. A 20-keyword batch, independent read-back, access after Pod deletion, and SIGTERM have been exercised in the Pod. Still open: live ad coverage from the cluster egress (no Sponsored card appeared in the Pod runs; parser checks rely on fixtures and one laptop sample), a blocked (CAPTCHA or consent) page in the Pod, and repeated batches over days. Record geographic ambiguity for every new keyword set. See [validation status](validation-status.md).

## Official references

- [Azure Blob Storage client library for JavaScript](https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-nodejs)
- [Playwright launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)
- [Playwright in Docker](https://playwright.dev/docs/docker)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes emptyDir volumes](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir)

## Manifest source of truth (UAT)

Since 2026-10-21 the UAT objects of this system (tracking UI with RBAC and Ingress, the two Web CronJobs, the daily monitor CronJob, their ConfigMaps and the three Secrets encrypted with sops) are mirrored in the environment repository `fbr-env-project` under `azure/uat/kube/resource/app/ai/6x-maps-*.yml`, `config/6x-maps-*.yml` and `secrets/enc/6x-maps-*.enc.yml` (namespace stays `uat`). The copies were exported from the live cluster and verified with `kubectl diff`. Images remain pinned by digest; the `deploy/` directories here keep the templates, READMEs and tests, and new digests are produced with `az acr build` as documented there. When a manifest changes, update both places: the environment repository is what the team applies, this repository is where the change is reviewed and tested.
