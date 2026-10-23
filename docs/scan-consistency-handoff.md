# Scan consistency repairs — 2026-10-23

## Status and scope

Base: `2841b33c7fc4bd47f0a3b92c4401f0de8590d086`. These are local source/template repairs, not a deployed release or live collection acceptance. No AKS, Azure, Mongo, shared SEO library, historical observations, schedules, or image digests were changed remotely. Build, push, rollout, real-device verification and cloud readback are separate steps.

The original counterexamples and baseline results are in [the code review](reviews/2026-10-23-current-code-review.md). The archived reproduction source targets that baseline, not the repaired interfaces. Executable regressions now live in `tests/`.

| Problem | Implemented behavior | Expected acceptance |
|---|---|---|
| Android edge correction discarded explicit ad/organic disagreement | All proposed joins compare the incoming type with the accumulated listing, including known → unknown → conflicting known sequences. Both observations remain visible; sequence/ranking reliability becomes false and natural ranks are null. Listing method is v19. | Both conflict directions fail closed; the original 239 → 339 review-count correction still succeeds when classification agrees. Display order is retained as observed evidence, not certified natural rank. |
| Workers read different settings and choose overlapping/incomplete shards | One initializer reads current monitoring stores once per Job UID, publishes an immutable config and assignments, then all workers use and verify it. | Same-round SHA matches across workers; each selected store appears in exactly one shard; edits appear in the next Job, not midway through this one. |
| Concurrent manual requests / scheduled-manual race | Kubernetes Lease CAS serializes UI requests. A shared Mongo target gate admits one Job round across scheduled and manual collectors. | Two UI replicas create at most one manual Job; competing Job rounds cannot both start queries. A rejected round remains rejected even if its second worker starts late. |

## Runtime contract

`JOB_UID` comes from the Pod's `batch.kubernetes.io/controller-uid` label (the **Job** UID, never Pod UID). `TRACKING_SCAN_GROUP` is the stable `<namespace>/<CronJob name>` target. Manual Jobs clone these fields from the template, so they use the same gate but a new Job UID. Explicit CLI runs may use `--round-id`; every worker must receive the same unique round ID. Never reuse a round ID for a rerun.

Checked-in target Web, target Android and legacy Web templates now carry these environment fields. Mutable Mongo multi-shard scans refuse to run without the group and round identity. Existing explicitly pinned catalogs and local unsharded usage retain their behavior. No schedule, resource requests, parallelism, keyword scope, or location settings were changed by this repair. Current target Web template is every three hours; target Android is daily and suspended with an unresolved image placeholder. This is not evidence of live schedule state.

In the configured tracking database, new collections are isolated from store configuration and observation collections:

- `scan-gate-rounds-v1`: immutable per-round admission decision (`initializing`, `admitted`, `blocked`). One initializer decides target admission; late workers cannot reverse rejection.
- `scan-execution-gates-v1`: one compare-and-swap document per target, recording round, revision, shard count, finished indexes and active flag.
- `scan-worker-admissions-v1`: permanent `<roundId>:<index>` admissions, preventing the same worker from recapturing after restart.
- `scan-round-snapshots-v1`: immutable settings snapshot and SHA, with initializing/ready/failed state. No automatic initializer takeover. Followers wait at most 120 seconds, then stop.

Mongo uses primary reads and majority write/read concerns. Unique `_id` insertion elects initializers; revision filters make target updates atomic. No TTL is applied to these records. Do not delete admission/snapshot records during ordinary history cleanup.

The snapshot is `tracking-scan-round/v1`, containing the full parsed config, request (surface/tier/shard strategy/count/store filter) and every shard assignment. Each scan uploads identical snapshot bytes as its `catalog.json` through the existing verified artifact boundary before queries begin. The scan receipt carries execution surface/tier/index/count/filter. Persistence checks the SHA, non-store config hash, actual surface/tier/filter, exact assigned store IDs and store contents. These snapshots describe monitoring settings, not a rewrite/import of the shared SEO keyword library.

## UI reservation and failure semantics

The UI needs namespace-scoped `get/create/update` on coordination Leases in addition to its existing Job/CronJob permissions. It does not delete or patch Jobs. A manual Job has a CronJob owner reference. The UI checks all paginated Jobs before limiting display to recent entries; a failed Pod counter alone does not make its Job terminal.

Lease name: `<CronJob>-manual-trigger`. Its holder is the exact proposed Job name. A successful Job creation marks the reservation `submitted`. Concurrent creation/update conflicts return HTTP 409. An ambiguous create response retains `reserved`; it is not automatically retried or stolen on a clock timeout. A terminal holder Job permits a CAS replacement. A missing `submitted` Job permits reuse after normal TTL cleanup. A missing `reserved` Job requires operator investigation because creation might still be in flight.

The execution gate is the last defense if Kubernetes schedules a Job concurrently with a UI request. The losing Job may exist and a Pod may start, but it cannot begin queries. Android's existing per-worker filesystem lock remains necessary because its emulator sidecar starts before the collector CLI. The shared gate is not a Kubernetes resource-reservation mechanism.

A gate is released only after all admitted indexes report a safe completion. Normal completed scans and evidence-only partial scans may release. Runtime exceptions, failed batches, cancellation, unconfirmed browser close, and killed/missing workers retain the gate. Browser close rejection is now distinct from successful close. Initialization/input failures before invoking a collector can safely mark that worker finished. An initializer crash, unknown Mongo write result, or incomplete worker set fails closed and needs inspection.

### Operator recovery (not performed by this repair)

1. Save Job/Pod status, UIDs, logs, scan receipts and all gate/round documents. Distinguish evidence partials from runtime errors. Never clear a gate merely because its timestamp is old.
2. Confirm **every** Pod/process for the owning round is stopped and no old worker can resume. Inspect Android Appium/session and per-worker runtime/device locks if cleanup was uncertain. Resolve the runtime problem first.
3. For an orphaned target gate, use a reviewed conditional Mongo update matching its exact `_id`, `roundId`, `revision` and `active: true`; set `active: false` and increment revision. Require exactly one match. Preserve the round and worker admission records. Do not fabricate finished indexes or edit the frozen snapshot. A crash during admission may leave an initializing round; close that old decision as blocked only after the same stop proof.
4. For an orphaned UI reservation, verify the exact holder Job and any in-flight request. Delete only that Lease using UID/resourceVersion preconditions after proving there is no active or uncertain launch. Do not remove healthy reservations automatically.
5. Any retry is a newly authorized Job with a **new UID/round ID**, not another attempt of the old worker. The new round reloads current settings. Shared SEO data and historical captures remain untouched.

There is intentionally no automatic stale-gate expiry. Until an operator clears a quarantined target, future scheduled attempts will fail closed rather than run overlapping collectors.

## Rollout and rollback prerequisites

Do not apply these templates while old-version collectors are active: old images do not participate in the shared gate. A future rollout must drain existing work, deploy compatible collector images and group/UID fields together, grant UI Lease permissions before upgrading UI, and verify Mongo permissions on the four coordination collections. This repair did **not** perform those steps. Preserve the existing schedules and data.

First isolate a small verification target: two workers with an intentional settings edit between startup times, two simultaneous UI requests, and a scheduled/manual admission race. Check query-start logs, identical catalog SHAs, exact shard union and complete artifact receipts. Exercise cleanup failure and operator recovery in that isolated target. Then perform a bounded Android fixture-equivalent real App test; offline OCR/XML tests do not prove current Google Maps UI behavior.

Rollback also requires draining gated work before restoring an old image. Never mix gated and ungated images on the same target. Keep snapshots and admissions as evidence; do not erase them to make a failed run look successful.

## Local verification

See the validation result appended below. Tests use local OCR/XML fixtures, mocked Mongo/Kubernetes interfaces, actual CLI dispatch wiring with mocked collectors, and local artifact persistence. They do not establish real AKS API/RBAC, Mongo failover, Android App or Azure delivery acceptance.

### Final local result

2026-10-23 Asia/Shanghai, after the final cleanup-exit handling change:

- `npm test`: contract compilation plus **1,665 tests passed across 87 files**, 103.08 seconds (started 09:47:10).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `python3 -m unittest discover -s deploy/android/linux -p 'test_*.py'`: **30 passed**.
- `git diff --check`: passed.
- Independent read-only code review: no remaining blockers after fixing its accumulated-classification, cleanup-release and snapshot-binding findings. Its focused verification passed 59 tests across six files plus typecheck.

The original three red regressions (both direct classification directions and concurrent UI creation) failed on the baseline before repair. Coverage now also includes intermediate unknown frames, single-read/next-round refresh, concurrent initialization, corrupted snapshots, initialization failure, missing identity, stale/rejected rounds, concurrent completion, CLI wiring on both surfaces, wrong config/shard/surface rejection, paginated active Jobs, terminal Lease reuse races, uncertain Job POST, TTL cleanup, and runtime cleanup quarantine. Final CLI exit is nonzero for cancellation or unconfirmed browser close even when a batch summary otherwise looks complete.

No remote acceptance was performed. Actual Kubernetes/Mongo outage behavior and current Maps App screens still require the isolated rollout checks above.
