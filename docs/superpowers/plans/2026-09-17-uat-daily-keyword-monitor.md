# UAT Daily Keyword Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use failing tests before implementation and record review results.

**Goal:** Read enrolled stores' current UAT keyword lists daily at Beijing midnight, capture up to 40 per store, and verify dated Azure evidence before reporting completion.

**Architecture:** A daily wrapper around the existing sequential batch collector. An explicit store registry defines enrollment; the keyword API supplies fresh words on every cycle. The wrapper snapshots selection, splits at 20, propagates global failures, maintains a daily manifest, and uses an atomic Azure claim to prevent duplicate dispatch for the same cycle.

**Tech Stack:** Existing TypeScript/Node/Playwright/Zod/Azure SDK; Kubernetes CronJob in UAT.

**Spec:** `docs/superpowers/specs/2026-09-17-uat-keyword-monitoring-design.md`

## Global Constraints

- Schedule `0 0 * * *`, timezone `Asia/Shanghai`; date grouping follows Beijing time.
- UAT only; preserve the separate dirty Dev schedule worktree.
- Original keyword unchanged; no map location override; 40 keywords/store, batches at most 20; 15 displayed listings/query by default.
- P0–P3 then stable source order; no fabricated numeric score. Empty surface tags do not remove local keywords.
- Initial registry uses the seven identity-linked records in the verified UAT inventory. Names remain stored names, not asserted canonical names.
- New UAT Azure container `maps-keyword-capture-uat` isolates results from Dev. Secret contents never enter source, browser environments, or logs.
- Readback of snapshots, batch evidence, and final daily manifest is required. Existing raw ranking/evidence semantics remain unchanged.
- No direct MongoDB credentials in the worker. Enrollment is explicit and requires registry updates for new stores.

## Task 1: Keyword source, daily wrapper, and CLI

**Ownership:** `src/monitor/`, `tests/monitor-*.test.ts`, `package.json` scripts only. Reuse `runBatch`, `ArtifactStore`, Azure gateway and naming helpers. Do not change the unrelated Dev CronJob.

**Interfaces:** Export a strict JSON config parser, a keyword API source, deterministic selection, and `runDailyMonitor` with injected source, store, batch runner, and atomic claim for testing. CLI entry `dist/monitor/cli.js --config /config/monitor.json --storage azure [--run-key <manual-cycle>]`; omitted run-key uses the current Beijing date. Log a final JSON `summary: true` with daily status, counts, manifest receipt and exit code.

Config shape:
```json
{
  "schemaVersion":"1",
  "sourceBaseUrl":"http://operation-assistant-api.uat.svc.cluster.local:80",
  "stores":[{"storeId":"only-bear","merchantId":"04ef8b4c-4837-4cf2-a8f5-0c9228658376","placeId":"ChIJgR0AKI2HwokRcMm_K7J7Phw","name":"Only Bear Chicken & Boba"}],
  "maxKeywordsPerStore":40,
  "batchSize":20,
  "sourceTimeoutMs":15000,
  "outputDirectory":"/work/outputs",
  "capture":{"maxResultsPerKeyword":15,"maxScrollsPerKeyword":6,"maxScreenshotsPerKeyword":5,"keywordTimeoutMs":90000,"locale":"en-US","browserTimezoneId":"America/New_York","filenameTimezone":"Asia/Shanghai","viewport":{"width":1440,"height":1000}}
}
```

- [ ] Write fixture tests for exact merchant/Place ID, missing scores, priority ties, duplicate words, unknown priority, empty lists, wrong identities, API timeout, ambiguous multiple records, and 40-to-20 splitting. Source failure is explicit per store, never an empty success.
- [ ] Run `npx vitest run tests/monitor-source.test.ts`; establish red, implement source/selection, then green. Reject unknown config fields and unsafe path IDs.
- [ ] Write daily tests proving all enrolled stores are accounted for, selection persisted before browser work, no overwritten attempts, batch/claim identity stable, blocked/storage/cancellation propagates to remaining batches, and final receipt governs successful delivery.
- [ ] Implement the daily wrapper with an atomic create-if-absent claim (`claims/<run-key>.json`). An existing claim yields a clearly labeled duplicate-skip outcome. A crashed cycle stays claimed; an explicit unique manual run-key provides recovery without overwriting history.
- [ ] Namespace batch paths under `<date>/<storeId>/<dailyRunId>/batches/<batchId>/`; snapshot per store and daily manifest at `<date>/daily/<dailyRunId>/manifest.json`. Preserve original raw result filenames containing timestamps and keyword slugs.
- [ ] Keep working files within bounded staging: remove a completed batch's staging only after verified remote delivery and a persisted daily checkpoint. Local-only mode retains its files.
- [ ] Add CLI signal handling and strict argument parsing. Global daily deadline 14 hours, shutdown grace 300 seconds to include batch and daily finalization. Do not leak optional API token to Chromium.
- [ ] Return 0 only for full capture and verified delivery (or an explicitly labeled duplicate skip), 2 for durably persisted partial coverage, 1 for operational/storage failure, 64 for invalid input.
- [ ] Verify own-store summaries only when canonical business IDs match; otherwise report `identity_unresolved`, never match only by a name or miscompare hex IDs to Place IDs. Full competitor list/rank extraction remains available.
- [ ] Run targeted tests, typecheck, full tests, and build; commit only owned files.

## Task 2: UAT deployment and operational docs

**Ownership:** `deploy/uat-monitor/`, `tests/uat-monitor-deploy.test.ts`, `docs/uat-monitor-operations.md`. No cluster mutation by the worker; root performs deployment after review.

- [ ] Build the seven-store registry from the read-only inventory `/Users/xander/.codex/worktrees/801b/chancetop/outputs/maps-keyword-capture-uat-review-2026-09-17/inventory.json` and the exact Task 1 config above.
- [ ] Create CronJob `maps-keyword-monitor-daily` in `uat`, initially `suspend: true`, schedule/timezone fixed above, `Forbid`, no Job retries, 3600s starting deadline, 7/7 history. Use 14h+600s outer deadline and 300s termination grace. The shared daily claim applies to manual and scheduled runs of the same run-key.
- [ ] Base the Pod on existing hardened `deploy/job/job.yaml`: non-root, read-only rootfs, restricted capabilities, `/work`, `/tmp`, shared memory, nodeSelector aiapp, requests 500m/1Gi, limits 2CPU/2Gi. No new Kubernetes API permissions or service-account token.
- [ ] Reference Secret `maps-keyword-monitor-storage` and separate UAT container. Pin the final root-provided image digest after build. Document source endpoint and no browser location override.
- [ ] Write deployment tests for midnight/timezone, valid config with seven linked stores, no static keyword list, deadlines/resources, suspended pre-acceptance rollout, and separate UAT names.
- [ ] Document build, create Secret without printing it, apply suspended, manual acceptance, readback, enable, failure/claim recovery, and storage retention. Commands must be paste-safe.

## Task 3: Review, image, UAT acceptance, and activation

**Ownership:** root, after independent review of implementation and deployment.

- [ ] Review the combined diff for spec and code quality; resolve material findings and run covering tests.
- [ ] Build linux/amd64 image through ACR with source commit, obtain digest and pin UAT manifests.
- [ ] Create the isolated UAT container and a container-scoped stored-policy SAS in the UAT Secret using captured outputs only. Never print credentials or commit generated secrets.
- [ ] Apply ConfigMap and suspended CronJob. Run a bounded functional manual cycle under a unique acceptance run-key for all seven stores, two keywords per store through a separate acceptance ConfigMap (14 queries). Preserve the production cap of 40 (260 estimated queries). Monitor source counts, blocked states, runtime, storage and termination; document that full-volume capacity remains untested.
- [ ] Download final daily and batch manifests with a separate Azure identity, check checksums and representative PNGs, and distinguish completed capture from durable partial evidence.
- [ ] Only enable the daily CronJob after functional acceptance. Read back schedule/timezone/suspend/image, remote evidence, and GitHub commit. Report any coverage shortfall precisely.

## Execution ledger

- Initial state: source keyword inventory verified directly in UAT; seven linked stores / 260 words at the proposed cap, five legacy unlinked records excluded with documented reason.
- Worktree `/tmp/maps-keyword-uat-execution` isolates ongoing Dev changes.

- Acceptance scope decision: 14 live queries across all seven stores validate the source/browser/storage chain; unit tests cover 40-to-20 batching. This does not establish full-260-query daily reliability or capacity. Activation requires all 14 captured plus independent Azure evidence readback.
