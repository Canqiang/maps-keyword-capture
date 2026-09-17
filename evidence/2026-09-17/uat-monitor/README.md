# UAT daily monitor release verification

## Scope

- Runtime source commit: `2ef649aefac659bcfcb4e247f67cdb871f9724f0`.
- Automated checks: 232 tests passed, typecheck and build passed. Independent review approved the failure-accounting and cross-batch stop regressions.
- Seven UAT per-place source calls returned HTTP 200 with one matching merchant/Place record each. The live parser selected 260 distinct keywords at cap 40, with no unknown priorities or exact duplicates.
- Functional browser acceptance scope: two keywords per enrolled store, 14 queries total, through a separate temporary ConfigMap. This is not full 260-query capacity validation.
- Independent readback uses Azure CLI login identity rather than the Pod's container SAS.

## Storage and scheduling

- Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`; public access is disabled (`null`).
- UAT Secret: `maps-keyword-monitor-storage`, stored policy `maps-uat-monitor-writer`, expiry `2027-09-17T13:35Z`. No credential values are stored here.
- Planned CronJob: `uat/maps-keyword-monitor-daily`, schedule `0 0 * * *`, timezone `Asia/Shanghai`.
- Separate Dev workload remains `dev-ai/maps-capture-daily`, `0 10 * * *`, `America/New_York`; it is outside this release.

## Release state

ACR build `ch144d` succeeded and the registry read back digest `sha256:78669533e5e6c6218d0e415992b665b48b1de3e9ab541030101a6c63e2f5d360`. The suspended UAT CronJob and production ConfigMap are deployed. The completed scoped acceptance and activation readback are recorded below; full-volume and full-ranking coverage are not established.

## Observed acceptance result

The smoke Pod ran from `2026-09-17T13:53:46Z` to `2026-09-17T13:58:28Z` using the exact pinned image. All seven source snapshots and all seven batches were processed: **14 attempted, 12 captured, 2 partial, 0 failed, blocked, skipped or source-failed**. The Pod correctly exited 2; its Kubernetes Failed status is a truthful partial-coverage signal, not a storage failure.

Independent Azure login readback downloaded **116 objects / 43,657,617 bytes**, including 52 PNGs, 14 result JSONs and 14 CSVs. Every referenced size and SHA-256 matched. Cross-checks confirmed original query text, query-only context, runtime commit, continuous display positions, and matching JSON/CSV row counts (186 listings total). No confirmed ad appeared in this smoke; ad parsing remains covered by the existing fixture tests.

Partial observations:

- `bakery`: 15 ordered listings and complete screenshot coverage, with one card of unknown ad/organic classification. Natural rankings from that ambiguity onward remain null.
- `flushing`:Google returned the Flushing, Queens region/detail page rather than a business list. The diagnostic PNG was visually confirmed; the result retains `partial / unsupported_layout`, zero listings and no invented ranking.

Original bakery, Flushing and Only Bear PNGs were visually reviewed. Wide-area results for generic words are expected when no location is specified, and do not establish rankings around the enrolled store. Original PNGs remain in private Azure, not this repository.

A second Job using the same run key returned `duplicate_skipped` with exit 0 and the original claim, without opening a browser or creating another daily manifest. It waited about 65 seconds for CPU capacity, then scheduled on the same node after the smoke ended. This does not prove full-volume capacity. During the smoke, completed batch staging was cleared after verified delivery; `/work/outputs` measured 284 KiB between batches.

## Explicit UAT activation exception

The original 14/14 complete-capture acceptance gate **did not pass**. The release owner accepts **UAT evidence-collection infrastructure only**, within the user's confirmed deployment and daily-schedule request: all 14 were attempted, all evidence was independently verified, and the two partial outcomes accurately preserve known query/classification limits. Independent review found no remaining monitor correctness defect. This exception does not relabel the daily result, suppress exit 2, claim reliable organic rankings for unknown cards, or establish full 260-query capacity. The daily production cap remains 40 per store; future runs must retain their actual coverage and failure reasons.

At `2026-09-17T14:04:52Z`, readback confirmed `schedule=0 0 * * *`, `timeZone=Asia/Shanghai`, `suspend=false`, the pinned image, seven enrolled stores, and the unchanged production cap of 40. The first expected scheduled run is **2026-09-18 00:00 Beijing time**; `lastScheduleTime` was still null, so no scheduled cycle had run at verification. The separate Dev CronJob remained unchanged. The completed smoke-only ConfigMap was deleted; both manual Job records remain for traceability. See `activation-readback.json`.
