# Independent Kubernetes Job Design (Not Yet Implemented)

## Selected approach

Run an independent Job in the existing cluster, once per batch, and exit when finished. The collector does not depend on a Core AI Agent session or the lifecycle of a long-running sandbox. No image, Job manifest, or live resources exist yet.

## Image and resources

- Use Node.js, a pinned Playwright version, and Google Chrome. Validate architecture compatibility during the build, record the Chrome version, and deploy by image digest.
- Run as a non-root user and verify the cluster capabilities required for Chrome's sandbox. Do not enable privileged mode, `hostIPC`, or `SYS_ADMIN` by default, or disable Chrome's sandbox without validating the implications.
- Configure an init process, child-process reaping, SIGTERM handling, per-keyword deadlines, and a batch deadline. Timeouts must terminate browser child processes.
- Start with one browser processing keywords sequentially. CPU request 500m / limit 2, memory request 1Gi / limit 2Gi, and shared memory of 256–512Mi are initial load-test candidates, not validated capacity requirements.
- Set explicit ephemeral-storage requests/limits and a temporary-disk `sizeLimit`. Mount `/dev/shm` separately and account for memory-backed volumes in the total memory budget.
- Bound viewport size and screenshot count instead of producing extremely tall full-page images. Preserve browser stderr, exit codes, and stage timings.

## Jobs and storage

- Create Jobs manually in the first version. Configure `activeDeadlineSeconds`, a bounded `backoffLimit`, and `ttlSecondsAfterFinished`. Automatic retries must preserve the logical `runId` to prevent duplicate data.
- Add a CronJob later if scheduling is required; it is not part of the current default scope.
- Grant access only to the object-storage prefix needed by the capture task. Use workload identity or a dedicated Secret rather than copying the full Core AI configuration.
- Local output, upload completion, and verified persistence are separate states. Verified artifacts and the manifest must remain readable after Pod deletion.
- Record CAPTCHA as `blocked`. Do not bypass it automatically or treat a challenge page as a valid result.

## Acceptance criteria

1. Validate extraction locally, then run 3–5 keywords in the target Pod, including `bubble tea garden city`.
2. Check display order including ads, ad labels, organic rankings, and separate ad/organic occurrences of the same business.
3. Confirm that overlapping scroll observations are not counted twice, lower listings have screenshot evidence, and uncertain rankings remain null.
4. Exercise no-result, CAPTCHA, timeout, and partial-success cases. Every input keyword must appear in the manifest.
5. Independently read back PNG/JSON/CSV files after upload and verify content and checksums. Confirm that the files remain accessible after Pod deletion.
6. Check that timeouts, termination, and normal completion leave no browser processes behind. Measure actual peak CPU, memory, and disk usage.

## Official references

- [Playwright and Google Chrome](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
- [Running Playwright in Docker](https://playwright.dev/docs/docker)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Google local ranking guidance](https://support.google.com/business/answer/7091?hl=en)
