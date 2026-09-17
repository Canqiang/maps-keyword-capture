# Deployment Summary (Not Yet Implemented)

The complete runtime design is in [Detailed Design](design.md#12-kubernetes-execution). Delivery gates are in [Implementation Plan](implementation-plan.md). No image, Job manifest, or live resources exist yet.

## Selected approach

Run one independent Kubernetes Job per keyword batch in the existing cluster. Use a dedicated Node.js/Playwright image with installed Google Chrome, one browser, and sequential keyword processing. Do not depend on a Core AI Agent session or long-running sandbox lifecycle.

Start with manual Jobs. Scheduling, a queue, and a run controller are later work.

## Initial settings to validate

| Setting | Proposed value |
|---|---|
| Browser launch | `channel: "chrome"`, `headless: true`, `chromiumSandbox: true` |
| Job parallelism / completions | 1 / 1 |
| Restart policy / backoff limit | `Never` / 0 |
| CPU request / limit | 500m / 2 |
| Memory request / limit | 1Gi / 2Gi |
| Ephemeral storage request / limit | 1Gi / 3Gi |
| Disk-backed work volume | 2Gi maximum |
| Dedicated memory-backed `/dev/shm` | 256Mi |
| Termination grace period | 30 seconds |
| Finished Job TTL | 24 hours |

These are unmeasured starting values. Set the application deadline from batch size and per-keyword budgets, with a separate outer Job deadline. Verify Chrome sandbox compatibility rather than silently disabling it. Shared-memory usage counts against the memory budget.

Run as non-root, keep permissions minimal, use scoped storage access, and mount writable paths required by the tested image. Do not enable privileged mode or host IPC by default. Pin the image digest and record Chrome, adapter, and application versions.

## Delivery and recovery

Persist and independently read back each completed keyword before starting the next. Store immutable artifacts under unique run/worker-attempt/query-attempt prefixes. Publish a final attempt manifest only after the artifact index is verified.

Collection quality and storage verification are separate states. Partial results may be durably saved; a successful process exit alone does not prove complete collection. Do not merge different attempts or automatically choose the attempt showing the best rank.

Use bounded application retries for transient browser errors. Stop on CAPTCHA and mark remaining inputs as skipped. Job-level retries are initially disabled. A crashed Pod may lose its unfinished query, while earlier verified results remain available. Exactly-once execution and automatic Pod-level resume are not promised by the initial version.

## Before deploying

Confirm the actual namespace, registry, node architecture, Chrome sandbox behavior, egress profile, storage provider and identity, and measured resource use. Validate 3–5 live keywords in the target Pod before a larger batch. Exercise timeout, SIGTERM, upload failure, and access to artifacts after Pod deletion.

## Official references

- [Playwright and Google Chrome](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
- [Playwright launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)
- [Playwright in Docker](https://playwright.dev/docs/docker)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes emptyDir volumes](https://kubernetes.io/docs/concepts/storage/volumes/#emptydir)
