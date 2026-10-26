# Two-hour rollout — Web operationally verified, Android probe partial

User authorization: complete remaining Android verification and implement both surfaces every two hours, preserving existing collection, shared SEO data and history. No reduction of the monitored denominator is implied.

## Current measured scope

Fresh Mongo planning on 2026-10-26 found nine active monitored stores: Web 620 keyword/point searches including enabled best variants; Android 356 base keyword/point searches with its existing bestVariants=false. Each store has three configured points, with per-keyword point selections preserved. These are not the old 270-search catalog.

Web has three workers and a 6,600-second Job deadline. The 09:15 Beijing round completed at 10:38:38 in 83m38s, all three original exits 0 and no restarts. Android is suspended, has two workers on one 4 CPU / 16 GiB crawler node, with a retained RWO runtime PVC and exclusive worker roots 0/1. At 10:54:45 Beijing, only Web spec.schedule changed from `15 */3 * * *` to `15 */2 * * *`, retaining America/New_York. The first expected slot 12:15 Beijing has not yet been observed.

## Execution ledger

1. Read-only live inventory, configuration snapshots and last run checks saved under `/tmp/maps-twohour-20261026`.
2. Native representative verification prepared and seeded in a new database/Job `maps-android-capacity-20261026`: one existing keyword per store at each of the three existing fixed points, 27 searches total. Candidate v33 digest `sha256:accac5a72cfc69f1b47ab3eb758c1b66aede231770dd4ddc68e0ea37a96d155e`. Two workers, unchanged resource envelope and stagger. Seed validated the exact 27-query plan. Preflight confirmed no active Android Pods and enough reserved capacity on the existing dedicated node. Full structured command journals and OCR evidence retained; raw Appium server logs retain only the last 4 MiB per worker. No historical gate cleared.
3. Web cadence changed only after full 620-query execution, Azure readback and exact Mongo reconciliation passed. Resource-version/old-value guards, no-active-same-group checks and a transition window prevented an unintended catch-up run. Image, configuration, parallelism and the completed Job evidence were preserved; the new spec was independently read back.
4. Android capacity is not accepted by a 27-query probe. With 356 searches, two workers need a mean below 40.4 seconds/search including overhead, substantially below prior complete native samples. Whole-store sharding also leaves KEKE's 74 searches indivisible. A fresh reviewer confirmed that simply increasing completions is unsafe: runtime only supports indices 0/1, quota permits two Pods, and the PVC cannot support arbitrary multi-node concurrent attachment.
5. Concrete scaling direction: immutable query-level assignments, global shard identity separate from local emulator identity, independently verified runtime storage per worker/node, existing admission and receipt protections retained. User decision: no expansion now; complete the representative verification and provide a resource plan. Do not activate a two-hour Android schedule that cannot meet the full denominator, or treat Forbid skips as success.

## Acceptance and scope limits

- Web: full current catalog completed inside the 6,600-second window, no failed delivery, schedule readback every two hours, existing work not interrupted.
- Android: complete multi-store/multi-point evidence, representative positive-ad classification on the release version, full current-catalog capacity inside the same window with headroom, actual GPS/follow-state receipts and explicit backend-geography uncertainty, complete journal/receipt reconciliation.
- Current GPS/native-follow proof does not establish Google backend locality. No expectedArea is configured for the nine stores; do not invent verified-local status.
- Preserve failures and explicit partial/unknown outcomes; no silent reruns or rank fabrication.

## Web final evidence

See [web-acceptance.json](web-acceptance.json). The frozen nine-store plan produced exactly 620 unique `(store, keyword, point)` observations over 47 batches:617 captured lists and 3 recognized detail pages; no other partial, failed, blocked, skipped or un-ingested searches. There were 165 own-store ranked observations, 452 not-found-in-observed-list observations and 3 not evaluated. These are observations, not 620 distinct keyword strings.

Independent Azure-login readback downloaded 4,723 objects. All 4,720 available writer size/SHA receipts matched. Three root `scan.json` records do not contain writer bytes/SHA in their log receipts; they were separately checked for service size and terminal-log content.47 mutable progress manifests were excluded, while referenced receipt closure remained mandatory. All 2,763 PNGs decoded;620 JSON/CSV pairs and 9,129 listing rows reconciled (79 ads, 9,050 organic). Mongo records match the frozen point coordinates, store identity, selected attempt, exact evidence, top10 projection, own rank and quality provenance. Eight independent negative mutation checks were rejected.

Visual QA viewed 15 PNGs across all nine stores, plus ads, list-end and both own/competitor detail cases. This limited visual sample is separate from full byte/structure checks. `spicy duck neck` at center/5km opens Xiaowei's detail; the 3km search instead returns a three-item list. `可可小卤 法拉盛` at center opens KEKE's own detail. Neither detail is rank 1. The previously empty `chinese take out near me` is present in this round at all three points, with `not_found` observations rather than missing records.

Operational cadence is accepted for this measured round, not guaranteed for future traffic. The first expected new-schedule slot is 04:15Z (12:15 Beijing,00:15 New York); the 06:15Z slot is the first one distinct from the old three-hour schedule. Neither future trigger has yet been observed. The schedule follows New York civil hours, including its daylight-saving transitions.

## Remaining Web interpretation limits

[Geographic findings](geographic-finding.md) remain open: camera coordinates are not a backend locality receipt. In the viewed `spicy duck neck` three-item list, Google explicitly displays a limited-view notice; list-end describes that observed view. Some `best` searches visibly apply a 4.0+ chip while current `context.filters` is hard-coded empty, so it does not establish absence of Google-applied filters. Review counts are absent from 9,127 of 9,129 Web rows; preserve null and do not present this round as a review-growth dataset. Follow-up should record these context signals and validate area-search behavior in isolation before changing the production collection profile.

## Android final representative verification — not production acceptance

See [android-acceptance.json](android-acceptance.json). The isolated v33 probe completed all 27 planned searches across nine stores/three points. Capture ran from 09:57:37 to 11:05:02 Beijing; the Job became Failed at 11:05:07 because both original collectors correctly returned exit 2 for partial results. There were 18 complete listings and nine needs-review outcomes: five `ranking_unreliable`, three `stalled_same_frame`, one `unknown_scroll_layout`; zero failed/skipped queries or container restarts. Production Android remains suspended, with no node expansion.

Independent Azure-login readback verified 6,124 objects: 6,122 exact writer size/SHA receipts and two root scan records with service-size/content checks. All 1,172 PNGs decoded; 27 query rows and 462 listings match manifests/CSV (18 ads, 441 organic, three unknown). All 27 same-source selected-frame replays match, and all 27 isolated DB observations match the source-derived ingestion apart from ingestion time. Exact frozen tuple/point/attempt provenance was separately checked. All 27 GPS receipts match the requested device coordinates and fresh follow state; Google backend geography remains unverified.

All 27,303 structured command entries were recovered with no failed commands and exactly one successful search submission per query. All 1,145 OCR process diagnostics have successful primary exits, no timeouts and no process failures. Raw Appium server logs are bounded tails, not full logs. Two runtime roots and fresh readiness receipts were checked independently; workers consumed 67.4 and 66.1 capture minutes.

Visual inspection covered 13 actual PNGs across all nine stores and all three partial reason categories. Eighteen sampled rating/review rows match; five visible Sponsored cards support the sampled ad classifications with null organic ranks. Two merchant-name transcription errors remain: `Zhong Huang Massage Spa 中皇` became `中 和 皇`, and `ER HOT POT - 6TH AVE 武火锅` became `AL FR`. A complete list sequence is not a guarantee of exact OCR spelling or merchant identity.

Remaining cases are preserved in `android-acceptance.json`. UWS center frames 38/39 visibly share the maman card, but the parser still withholds continuity. Connexion 3km stalls on a sponsored card with an offer; no list-end proof exists. KEKE 5km ends with visible list cards while scroll layout is classified unknown. Do not turn these into successful ranks or retry production from this document. Reproduce against exact original PNG/XML/OCR and independent geometry, preserving conservative classification and no repeated search submission. The [capacity plan](../../../docs/android-two-hour-capacity-plan.md) records measured limits; the full 356-search/two-hour gate is still unmet.

## Bounded follow-up

Heartbeat `uat` is active only for the October26 12:15 and14:15 Beijing Web rounds. Their actual trigger/completion is pending, not implied by the schedule change. The read-only watcher retains live status/logs before Job TTL cleanup; future checks reconcile all manifests/observations and explicitly bounded artifact samples. Pause after those two rounds or a terminal blocker. See [followup.json](followup.json).
