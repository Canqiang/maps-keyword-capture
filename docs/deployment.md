# Deployment Summary (Not Yet Implemented)

The complete runtime design is in [Detailed Design](design.md#12-kubernetes-execution). Delivery gates are in [Implementation Plan](implementation-plan.md). No image, Job manifest, or live resources exist yet.

## Selected approach

Run one independent Kubernetes Job per keyword batch in namespace `dev-ai` of the FBRDev AKS cluster (eastus2). Use an image based on the official Playwright Linux image with its bundled Chromium, one browser, and sequential keyword processing. Publish to `fbrdevacr.azurecr.io/ai/maps-keyword-capture`, schedule on `envpool=aiapp`, and pull with `docker-registry-secret`, matching the existing `dev-ai` Jobs. Do not depend on a Core AI Agent session or long-running sandbox lifecycle.

Start with manual Jobs. Scheduling, a queue, and a run controller are later work.

The first version uses query-only search: omit `mapView` from the input, submit the original keyword without coordinates or simulated geolocation, and do not pan the map or click "Search this area". Retain the egress context and final URL as metadata. Inspect the returned area for region-bearing keywords on the target Pod; the [local query-only samples](../evidence/2026-09-17/README.md) show that an area name alone does not ensure local results. Record ambiguity for review; do not silently rewrite queries or force the map view if results differ.

## Initial settings to validate

| Setting | Proposed value |
|---|---|
| Browser launch | bundled Chromium with `channel: "chromium"` (new headless mode, not the headless shell), `headless: true`, `chromiumSandbox: true` |
| Job parallelism / completions | 1 / 1 |
| Restart policy / backoff limit | `Never` / 0 |
| CPU request / limit | 500m / 2 |
| Memory request / limit | 1Gi / 2Gi |
| Ephemeral storage request / limit | 1Gi / 3Gi |
| Disk-backed work volume | 2Gi maximum |
| Dedicated memory-backed `/dev/shm` | 256Mi |
| Termination grace period | 30 seconds |
| Finished Job TTL | 24 hours |

These are unmeasured starting values. Set the application deadline from batch size and per-keyword budgets, with a separate outer Job deadline. Verify Chromium sandbox compatibility rather than silently disabling it. Shared-memory usage counts against the memory budget.

Run as non-root, keep permissions minimal, and mount writable paths required by the tested image. Do not enable privileged mode or host IPC by default. Pin the image digest and record Chromium, adapter, and application versions.

Storage target: Azure Blob account `fbrdevstorage`, container `seo`, prefix `maps-keyword-capture/`. Credentials come from the existing `dev-ai` Secret `azure-storage-account-f6eab793693c54a6891af3c-secret`; the account key is whole-account access, and prefix-scoped workload identity is later hardening.

## Delivery and recovery

Persist and independently read back each completed keyword before starting the next. Store immutable artifacts under unique run/worker-attempt/query-attempt prefixes. Record each verified artifact's key, size, checksum, and verification time in the manifest, then upload the manifest and read it back; there is no separate artifact index.

Collection quality and storage verification are separate states. Partial results may be durably saved; a successful process exit alone does not prove complete collection. Do not merge different attempts or automatically choose the attempt showing the best rank.

Use bounded application retries for transient browser errors. Stop on CAPTCHA and mark remaining inputs as skipped. Job-level retries are initially disabled. A crashed Pod may lose its unfinished query, while earlier verified results remain available. Exactly-once execution and automatic Pod-level resume are not promised by the initial version.

## Before deploying

Confirm Chromium sandbox behavior on the `aiapp` nodes and measured resource use. Earlier environment notes reported the namespace, registry, Virginia egress, and storage target on 2026-09-17; recheck operational values before deployment. Recovered laptop probes include Chrome, Chromium, a visible Sponsored card, and three query-only first screens. No target-Pod acceptance evidence exists in this repository, and the archived scripts did not explicitly enable the sandbox. Validate 3–5 live query-only keywords in the target Pod before a larger batch, including ad coverage. If no live ad appears, record that gap and use fixtures for parser checks; do not declare live ad acceptance passed. Reconcile full listing order and screenshot coverage under the provisional budgets, record geographic ambiguity, and exercise timeout, SIGTERM, upload failure, and artifact access after Pod deletion. See [validation status](validation-status.md).

## Official references

- [Azure Blob Storage client library for JavaScript](https://learn.microsoft.com/azure/storage/blobs/storage-quickstart-blobs-nodejs)
- [Playwright launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)
- [Playwright in Docker](https://playwright.dev/docs/docker)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes emptyDir volumes](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir)
