# Validation status

Updated 2026-09-17. This page distinguishes recovered historical evidence, compile-time checks, and unfinished runtime acceptance. The local collector now exists and has run against the live site once; see [Local collector run](#local-collector-run-2026-09-17) for what that run did and did not show. No container image, storage adapter, or deployed Job exists yet, and no artifact has been delivered anywhere but the local disk.

## Evidence ledger

| Item | Current evidence | Status / outstanding work |
|---|---|---|
| Chrome versus bundled Chromium | Original probe scripts and centered-map PNG sequences | Local rendering samples only; Linux/Pod equivalence unvalidated |
| Sponsored placement | Gong Cha label visible in `ad_shot_00.png`; matching business details appear later in `ad_shot_02.png`. No Sponsored card appeared in the first 2026-09-17 local run (0 of 47 listings). A later run the same day (`run_20260917T085705Z_318ec2`) captured a live Sponsored Gong Cha at display position 1 for `bubble tea garden city ny`, classified `ad` with `organicRank: null`, and the same business again as organic at position 5 with `organicRank: 4`; the label is legible in the first screenshot. The next run of the same keyword showed no ad | One live ad layout classified end to end. Label ownership for group-level markers and other ad layouts remain unverified; ads are not shown on every load |
| DOM stride, dimensions, label depth, exact browser version | Historical notes and inspection scripts | Raw DOM/stdout not recovered; reproduce with saved logs before treating as parser acceptance |
| Query-only input | `qonly.mjs` constructs a query URL without a center/zoom; three first-screen PNGs recovered. The 2026-09-17 local run collected four keywords end to end this way: 47 listings, 15 results PNGs, complete scroll sequences, `configuredMapView: null` and the original keyword read back from the page in every result | Complete locally on one machine and one egress. Not target-Pod acceptance. `observedMapView` was null in the first run because the URL was read at navigation; the entry page rewrites it to `/maps/search/<query>/@lat,lng,zoomz` about 3.5 s after the feed appears, and results now record the URL at observation time (see follow-up fixes) |
| Geographic meaning | Garden City and Matcha samples show broad map extents and differing geographic signals | Review geographic ambiguity; preserve query text, never force a preferred city silently |
| 15 listings within 6 scrolls / 5 results screenshots | Measured on 2026-09-17: `fried chicken mineola` reached the 15-listing limit in 4 scrolls and 5 results screenshots, the only keyword to reach the limit. The other three ended at the list end first: 13 listings / 3 scrolls / 4 PNGs, 5 / 1 / 2, and 14 / 3 / 4 | Both budgets held, but the screenshot budget was consumed exactly at 5/5 on the one keyword that reached 15, so it has no margin. Four keywords on one machine; not a distribution, and not measured in the Pod |
| Contract shape | `src/contracts.ts`, `tests/contracts.type-test.ts` | Compile-time constraints covered; external JSON and cross-field relationships still need runtime validators |
| Empty, consent, CAPTCHA, second ad layout | No recovered samples | Missing fixtures and runtime evidence |
| Sandboxed Chromium in target Pod | Dev trial Job on 2026-09-17 (`deploy/dev-trial`): Chromium launched with `chromiumSandbox: true` as uid 1001, all capabilities dropped, no privilege escalation, read-only root filesystem, default seccomp; 5 keywords captured and no browser process left after the batch | Startup, a 20-keyword batch, and SIGTERM shutdown verified in the Pod on 2026-09-17 (see Production Job acceptance). Repeated runs from the same egress over days are not yet exercised |
| Azure persistence | Production Job run `run_20260917T113857Z_9666dc`: 123 artifacts uploaded, each read back by the collector, then independently downloaded with a separate identity; all sizes, SHA-256 values, and 62 PNG signatures matched, the final manifest matched its printed receipt, and all 125 objects remained after the Pod was deleted | Verified for one batch. Revocation (storage refusing every request) and SAS/Secret rotation were exercised in the Pod on 2026-09-17; a stalled or throttling account is covered by local tests only |

See the [evidence archive](../evidence/2026-09-17/README.md) and its [inventory](../evidence/2026-09-17/inventory.json) for original files and hashes. Source modification times are not browser capture timestamps. No recovered PNG is promoted to a structured, verified ranking result.

## Contract checks

```bash
npm run typecheck
npm test
```

The contract suite covers paid/unknown rank exclusions, success versus exhausted budgets, skipped input accounting, readback fields required by verified artifacts, attempt identity, evidence binding, and configured versus observed location. The tests were first run against the old contracts and failed before the missing shapes and constraints were added.

These checks do not launch Chromium, validate external JSON, or prove business behavior. Runtime acceptance must validate numeric ranges, hashes/timestamps, unknown configuration fields and reserved `mapView`, prefix continuity, classification evidence ownership, image coverage, artifact/attempt references, and the manifest's selected-attempt policy. In particular, a captured result requires all emitted cards to have supported classification and complete screenshot coverage. Storage status remains separate from collection quality.

## Next acceptance gate

The deterministic fixtures and the bounded collector now exist; the runtime validator does not. Re-run the three original keywords in the target Pod under the recorded query-only profile, inspect returned areas without changing queries, save raw observations and complete screenshot sequences, and measure budgets. Exercise missing layouts and failure states. Then verify Azure delivery and access after Pod deletion. Do not treat a successful probe exit or uploaded blob as completed acceptance.

## Local collector run (2026-09-17)

First end-to-end run of the collector against the live Google Maps site, from the developer laptop
(macOS, bundled Chromium `153.0.8010.12`, adapter `maps-feed-card/v1`, headless, `chromiumSandbox: true`).
Local-only persistence. This is one run, on one machine, through one egress, on one day; nothing below
is a property of Google Maps or of the collector in general.

Run of record: `run_20260917T061346Z_f832fd` / attempt `att_ee05c619`, exit code 0, batch status
`completed`. Manifest:
`outputs/maps-keyword-capture/2026-09-17/run_20260917T061346Z_f832fd/att_ee05c619/manifest.json`
(not committed; `outputs/` is ignored).

### Per-keyword outcome

| Query | Keyword | Status | Stop reason | Observed | Results PNGs | Scrolls |
|---|---|---|---|---|---|---|
| q0001 | bubble tea garden city | captured | end_of_results | 13 | 4 | 3 |
| q0002 | best bubble tea mineola | captured | end_of_results | 5 | 2 | 1 |
| q0003 | fried chicken mineola | captured | limit_reached | 15 | 5 | 4 |
| q0004 | matcha mineola | captured | end_of_results | 14 | 4 | 3 |

47 listings and 15 results screenshots in total. Every listing is `resultType: "organic"`;
`organicRank` runs 1..N with no gaps and no `unknown` in any of the four results.

**No Sponsored card appeared.** No listing was classified `ad`, and the string `Sponsored` does not
occur in any captured DOM text across the four keywords. The earlier probe's Gong Cha ad did not
reappear, so this run neither confirms nor contradicts the ad classifier: it did not exercise it.

### Reconciliation against the screenshots

`bubble tea garden city` was reconciled in full, every listing against every PNG; the other three were
spot-checked at their first and last screenshots.

1. **Display order and coverage.** Match. For q0001 the visual order across the four PNGs is exactly
   `displayPosition` 1..13, and every listing's `screenshotIds` point at a PNG in which that card is
   fully visible with its name legible. Cards cut off by the pane bottom are excluded from that
   screenshot and picked up by the next one (Arden is cut in `__01.png` and carried by `__02.png`),
   and cards visible in two consecutive screenshots carry both ids without being counted twice.
2. **Ad labelling.** Vacuously consistent: no card is visually marked Sponsored and no card is
   classified `ad`.
3. **Organic ranks.** Match: contiguous 1..N per keyword, no `unknown` cards, so the
   "null after any unknown" rule was not exercised.
4. **Counts and stop reasons.** Consistent. The three `end_of_results` keywords each show
   "You've reached the end of the list." in their final PNG, below the last recorded listing. For
   `fried chicken mineola` the final PNG shows cards 16, 17 and 18 (The Black Sheep Ale House, Kaiyo,
   7th Street Burger Mineola) present on the page and correctly absent from the output at
   `limit_reached`.
5. **CSV.** UTF-8 BOM, CRLF, header plus one row per listing, consistent column counts. `Café` and
   `Sip & Chill | Boba & Coffee House` survive intact, and of 918 cells none begins with `=`, `+`,
   `-`, `@`, tab or CR.
6. **Location.** `finalUrl` is recorded for every keyword and is the unchanged query-only URL.
   `context.observedMapView` is **null for all four keywords**: the entry-page URL never gains an
   `@lat,lng,zoom` segment, so there is nothing for the parser to read. This is left as-is, not
   fixed; the returned area is evidenced only by the map pixels and the listing addresses. The keywords
   were not altered and no city was appended. `bubble tea garden city` mixes regions exactly as the
   earlier probe suggested: within one result list, `3102 E Kansas Ave` (Kansas), `682 Stewart Ave`
   and `988 Franklin Ave` (Garden City NY), `3355 S Yarrow St` and `14101 E Exposition Ave`
   (Colorado), and `2700 Western Center Blvd` (Texas), over a continent-scale map. `best bubble tea
   mineola` and `fried chicken mineola` returned a local Nassau County map; `matcha mineola` drifted
   into Manhattan and Brooklyn addresses at ranks 9-12. Treating any of these as a local ranking
   would be wrong.
7. **Manifest.** All 27 artifacts exist at their recorded paths with byte counts matching
   `bytes` exactly (0 mismatches). Every keyword carries a terminal status and
   `persistenceStatus: "not_requested"`; artifacts carry `storageStatus: "local_only"` with a null
   `objectKey` and null `verifiedAt`.

### Defects found and fixed during this run

The first two live attempts did not produce data at all. Each was reproduced with a failing test
before being fixed; the suite went from 84 to 90 tests.

- **The page script could not run in the page.** Every keyword failed instantly with
  `page.evaluate: ReferenceError: __name is not defined`. `npm run capture` runs through tsx, whose
  esbuild transform hardcodes `keepNames`; it rewrites the page script's inner function to
  `const box=__name(r=>({...}),"box")`, and Playwright ships only the function source to the page,
  where no `__name` exists. The fixture tests never caught this because vitest's transform does not
  add the helper, so the same function serialized differently under test than in production.
  `readSnapshot` now evaluates the script inside a scope that defines `__name`.
- **The query field selector did not match the live entry page.** All four keywords then returned
  `partial / query_mismatch` with zero listings. Measured on the live page: `input#searchboxinput`
  never appears on the `?api=1&query=` entry page, the query sits in `input[name="q"]`, and both that
  field and the document title stay empty for roughly 0.8s *after* the results feed has rendered
  (feed present at 1.86s, query and title filled at 2.6s). The collector could therefore sample a
  stable feed while no query evidence existed yet and call it a mismatch. The selector now includes
  `input[name="q"]`, and a missing signal is waited out once rather than read as a mismatch.
- **Ratings were dropped whenever a card showed a review count.** Live cards label the rating
  `"4.8 stars 97 Reviews"`, but the selector required the aria-label to *end* with `" stars"`, so it
  matched the plain variant and missed the review-count one: `best bubble tea mineola` recorded
  `rating: null` for all five listings while the rating was plainly legible in the screenshot. Google
  serves both variants for the same keyword at different times, so which fields survived depended on
  when the run happened. Both label shapes now parse; in the run of record 0 of 47 listings have a
  null rating.
- **A spent budget was reported as a query mismatch.** Found while exercising the timeout below, in
  the wait introduced above: when the deadline expired before the query rendered, the result blamed
  the query instead of the budget. It now stops with `timeout`.

`reviewCount` is null for `bubble tea garden city` and `fried chicken mineola` and populated for the
other two. This is faithful, not a defect: Google served those cards without a review count, and the
screenshots show none.

### Timeout and shutdown

- **Controlled timeout.** One keyword with `keywordTimeoutMs: 5000` ended `failed / timeout`,
  `observedCount: 0`, error `no listings collected before timeout`, exit code 1, with the result JSON,
  CSV and observations still written. It did not hang. It also did not stop at 5s: the attempt ran
  **12.3s**, because the budget is checked at stage boundaries rather than enforced as a hard kill —
  navigation is granted a 1s floor and a stability observation completes once started. A Pod deadline
  must allow for this overshoot rather than assume `keywordTimeoutMs` bounds the attempt.
- **Clean shutdown.** `SIGINT` mid-batch printed
  `SIGINT received: finishing the current keyword, skipping the rest`, wrote `manifest.json`, and
  exited 130 with every input accounted for: `captured 1, failed 1, skipped 2`, the two untouched
  keywords recorded `skipped / cancelled` with no attempts. The keyword *in flight* at signal time
  does not survive, despite the message: its browser is closed underneath it and it is recorded
  `failed / error` with `page.screenshot: Target page, context or browser has been closed` (and in a
  second trial `navigation failed`, after burning a retry attempt on `qa02`). No data is lost and
  nothing is miscounted, but a deliberate shutdown is currently recorded as an error rather than as a
  cancellation.
- **Process cleanup.** Zero leftover browser processes after both the normal batch and the SIGINT
  run. Measured as Playwright-bundled Chromium executables specifically; the brief's
  `ps aux | grep -i chrom | wc -l` returns ~25 on this machine because the developer's own Google
  Chrome and PyCharm's CEF are running and have nothing to do with the collector. The counting method
  was validated against a deliberately open browser (6 processes while open, 0 after `close()`).

### What this run does not establish

- No consent page, no CAPTCHA, no no-results page and no second ad layout were encountered, so those
  paths remain covered only by fixtures. A `/sorry/` page still trips the batch circuit breaker in
  code alone.
- No ad appeared, so live ad classification and label ownership remain unvalidated.
- Not run in the target Pod: no sandboxed-Linux startup, resource, SIGTERM or egress evidence.
- No Azure delivery: persistence is local-only and no artifact has been uploaded or read back.
- One machine, one egress, one day, four keywords. The returned areas reflect this laptop's network
  location, not a client's.

## Follow-up fixes after live review (2026-09-17 evening)

A review of the screenshots and field values from the local runs found six problems. Each fix has a fixture test that failed first; the suite is 116 tests.

| Finding on the live page | Fix |
|---|---|
| Map tiles still loading in screenshots (blank grid areas), and Google's first-visit "Collapse side panel" hint over the map. The hint is not hover- or focus-driven; Escape does not dismiss it; measured on three keywords it shows ~0.3 s to ~8.4 s after the feed appears. Map tiles arrive in batches with brief identical-frame pauses, and settle ~3.5-4.5 s after the feed. | A screenshot is taken only after three consecutive byte-identical frames with no transient hint on screen, within 10 s for a keyword's first frame and 2.5 s after a scroll. The page is never modified. If the budget runs out, the last frame is kept and the result carries a `map_unsettled` warning; list evidence is unaffected. Adds about 8 s per keyword. |
| `observedMapView` null on every result | The final URL is taken from each observation, so the rewritten `@lat,lng,zoomz` URL is recorded. `plumber mineola ny` returned Mineola, NY businesses on a zoom-5 view of the eastern US, which the screenshot confirms. |
| Ad card `category` read "Gong Cha 3.9 Bubble tea store" | Icon-font glyphs (private-use characters such as U+E5D4 after "Sponsored") are removed from card text in the page, which had broken the name-prefix stripping. |
| Addresses carrying a phone number or a description line | Category and address come from the rendered card line `Category · address`; a trailing phone number is dropped. |
| A nonsense query returned a locality card ("Mineola, Texas 75773", no rating, no category) ranked organic #1 | A card counts as an organic business only with a rating or a `Category · address` line; otherwise it is `unknown`, and the result is `partial / classification_unknown`. |
| Ctrl+C under `npm run capture` killed the process before `manifest.json` and left two browser processes | The terminal delivers SIGINT to both npm and node and npm forwards it again; signal handlers are now persistent and idempotent (SIGINT, SIGTERM, SIGHUP), so repeated signals are ignored while the in-flight keyword stops. |

Verification run `run_20260917T094345Z_c373eb` (four keywords): three `captured`, the nonsense keyword `partial / classification_unknown`; no `map_unsettled` warnings; `observedMapView` recorded for the three real keywords; no address containing a phone number or longer than 40 characters, and no category starting with a rating. `fried chicken mineola` again used all 5 results screenshots for 15 listings.

## Dev trial run in the target cluster (2026-09-17)

A manual Job (`deploy/dev-trial/job.yaml`) ran image `fbrdevacr.azurecr.io/ai/maps-keyword-capture:35cd4db` (`sha256:172bbbd9…`) in namespace `dev-ai` on node `aks-aiapp-34077033-vmss000004`, run `run_20260917T100353Z_3a51a6`, with no Azure upload. Results were copied out with `kubectl cp`; all 30 artifacts matched the manifest's size and SHA-256.

| Keyword | Status / stop reason | Listings | Results PNGs | Observed map view |
|---|---|---|---|---|
| bubble tea garden city ny | captured / end_of_results | 7 | 2 | 40.7337, -73.6485, z14 |
| fried chicken mineola | captured / limit_reached | 15 | 5 | 40.7485, -73.6363, z14 |
| matcha mineola | captured / end_of_results | 4 | 1 | none (see below) |
| plumber mineola ny | captured / limit_reached | 15 | 4 | 38.8421, -83.6258, z5 |
| dentist garden city ny | captured / limit_reached | 15 | 3 | 40.7278, -73.6365, z14 |

- **Access from the cluster egress.** The Pod egress is Microsoft AS8075 in Boydton, Virginia. Every keyword reached the results page on the first navigation (~1.2 s); no CAPTCHA, consent page, or retry. One batch of five keywords; repeated or larger batches from this egress are untested.
- **Sandbox and security context.** Chromium started with its sandbox enabled under `runAsNonRoot` (uid 1001), `capabilities: drop [ALL]`, `allowPrivilegeEscalation: false`, and `readOnlyRootFilesystem: true`, with memory-backed `/dev/shm` (512Mi) and `emptyDir` mounts for `/tmp` and `/work`. No `imagePullSecrets`: the kubelet identity pulls from `fbrdevacr`, as for other `dev-ai` workloads.
- **Rendering.** Screenshots show loaded map tiles, the filter bar, and no transient hint; fonts render normally in the container.
- **Time and resources.** The batch took 88 s for five keywords (10.7-24.6 s each, including the first-frame settle wait). `kubectl top` samples every ~16 s peaked at 1120m CPU and 441Mi memory, within the requests of 500m / 1Gi and limits of 2 / 2Gi; the sampling is too coarse to rule out short spikes. No browser process remained after the batch.
- **Results differ from the laptop.** `matcha mineola` returned 4 listings ending in "You've reached the end of the list", against 14 from the laptop earlier the same day; the screenshot confirms the short list. Rankings for the other keywords matched the laptop runs at the top positions. No Sponsored card appeared in this run.
- **Defect found and fixed.** For a keyword finished in a single observation (`matcha mineola`), `observedMapView` was null: the URL was read from the snapshot taken before the first screenshot waits for the view to settle, and the page rewrites its URL during that wait. The runner now reads the page URL after the screenshot; the fix is in image `bd59879` (`sha256:9c7c86e3…`), which `deploy/dev-trial/job.yaml` now pins. The trial was not re-run with that image.

Still outstanding before a production Job, as of this trial: Azure Blob upload with read-back verification, SIGTERM and deadline behaviour inside the Pod, a full 20-keyword batch, and the deferred hardening items (final manifest written before closing the browser, a breaker for repeated unsupported layouts). Done on 2026-09-17 (see Production Job acceptance below): Azure Blob upload with read-back verification, the full 20-keyword batch, SIGTERM inside the Pod, and the final-manifest ordering. The ordering was resolved by capping the browser close at 10 s, so a hung close cannot hold up the manifest. Deadline behaviour inside the Pod has not been exercised. The unsupported-layout breaker is implemented and fixture-tested but has not run against the live site.

## Production Job acceptance (2026-09-17)

Storage: private container `maps-keyword-capture` in `fbrdevstorage` (public access off), stored access policy `maps-capture-writer` (read, create, write; expires 2027-09-17), container SAS in Secret `maps-keyword-capture-storage` in `dev-ai`. Image `fbrdevacr.azurecr.io/ai/maps-keyword-capture:4255d75` (`sha256:367902f0…`), Job from `deploy/job/job.yaml`.

- **Local delivery through `az login`.** One keyword (`fried chicken mineola`) from a laptop with `AZURE_STORAGE_ACCOUNT_URL`: exit 0, `remotePersistence: verified`, 11 objects with correct content types.
- **Scheduling.** The first Job stayed `Pending`: every `aiapp` node had less than one core unreserved (381m, 281m, 281m, 831m), and the pool has a fixed four nodes with no autoscaler. The CPU request was lowered to 500m; the rerun scheduled on `aks-aiapp-34077033-vmss000004`. A busier pool could block even 500m.
- **20-keyword batch** (`run_20260917T113857Z_9666dc`). All 20 keywords `captured` with `persistenceStatus: verified`; 14 reached 15 listings and 6 ended at the list end (3 to 12 listings). Per keyword 10.7-24.2 s; the batch took 6 min 10 s, well inside the 3000 s deadline. `kubectl top` every 15 s peaked at 1118m CPU and 654Mi memory, against limits of 2 and 2Gi. Exit 0; the summary line reported `remotePersistence: verified` and a verified receipt. No log line contained a SAS signature. No Sponsored card appeared in this batch.
- **Independent read-back.** All 125 objects under the run prefix were downloaded with a separate identity (`az login`, not the SAS). The manifest lists 123 artifacts, all `verified`; every size and SHA-256 matched, all 62 PNGs start with the PNG signature, and the only unlisted objects are `manifest.json` and `manifest.progress.json`, as designed. The downloaded `manifest.json` SHA-256 equals the receipt printed in the Pod log. Total 47.2 MiB.
- **Durability.** After deleting the Job and its Pod, the prefix still held 125 objects and `manifest.json` downloaded byte-identical.
- **SIGTERM.** A five-keyword Job was stopped with `kubectl delete pod --grace-period=60` right after the first keyword finished. The Pod exited within 4 s. The uploaded manifest shows the first keyword `captured`, the in-flight keyword `partial / cancelled` with its 8 listings delivered and verified, and the remaining three `skipped / cancelled`; `manifest_published` was logged with `storageStatus: verified` before exit. Kubernetes marked the Job failed (`BackoffLimitExceeded`), as expected for a terminated Pod.

Not yet exercised: a blocked (CAPTCHA or consent) page in the Pod, repeated batches from the same egress, the unsupported-layout breaker against the live site, and a stalled or throttling storage account in the Pod (covered by local timeout tests only). Revocation and rotation were exercised afterwards; see below.

### Hardened image check (2026-09-17)

After the final-review fixes (bounded blob calls with a 15 s per-call abort and fast-fail, one checkpoint on any batch stop, exit 0 only when every non-skipped row is delivered, SAS removed from Chromium's environment, explicit process exit after the summary, 120 s shutdown grace), image `bc25853` (`sha256:c48e031f…`) was pinned in `deploy/job/job.yaml` and run with three keywords (`run_20260917T123545Z_4960f6`): all `captured` and `verified`, receipt `verified`, exit 0, and the container finished in the same second as `manifest_published`. During the run, all 12 Chromium processes in the Pod had no `AZURE_STORAGE_*` variables in their environment; only `tini` and `node` carried the SAS. No log line contained a SAS signature. Stalled or throttled storage was exercised only by local tests against a non-responding server, not in the Pod.

## Storage revocation, SAS rotation, and the stop runbook (2026-09-17)

All steps used the commands in `deploy/job/README.md` as written, with image `bc25853`.

- **Revocation as an outage.** Deleting stored access policy `maps-capture-writer` made every request with the existing SAS fail with HTTP 403 `AuthenticationFailed`. A two-keyword Job (`run_20260917T130351Z_75879f`) failed its `request.json` preflight, skipped both keywords as `storage_unavailable` without launching a browser, made its one bounded final-manifest attempt (also 403, receipt `failed`), and exited 1 about 1 s after starting. No log line contained a SAS signature. This is an immediate refusal; a stalled or throttling account was not reproduced in the Pod.
- **Rotation.** The policy was recreated with the same name, and the README's rotation block regenerated the SAS and replaced the Secret with `kubectl replace`. The Secret kept its single key and has no `last-applied-configuration` annotation. The next Jobs delivered with receipt `verified`. (`kubectl replace` from `create --dry-run=client` drops the Secret's labels; nothing depends on them.)
- **Stop runbook defect found and fixed.** The documented "follow the log, then delete the Job" sequence lost the log: `kubectl logs -f job/…` in the background had not attached before the Job was deleted and exited with NotFound, so the receipt was not captured. Delivery itself was unaffected: that run's manifest (`run_20260917T130537Z_cd1aea`) was uploaded and verified, with the in-flight keyword `partial / cancelled` and the rest `skipped / cancelled`. The runbook now streams the Pod's log, deletes the Pod, waits for the stream, prints the summary, and then deletes the Job. Rerun (`run_20260917T130646Z_ce400e`): the saved log held the summary with receipt `verified`, and no Job or Pod was left.


## UAT daily monitor — 2026-09-17

UAT daily monitoring is enabled for 00:00 Asia/Shanghai with seven enrolled stores and cap 40 each (current source selection 260). The scoped 14-query smoke returned 12 captured and 2 partial, exit 2; no source, storage, block or skipped outcomes. All 116 referenced objects (52 PNGs) passed independent Azure readback. The original 14/14 capture gate did not pass; the documented exception accepts evidence-collection infrastructure only, with full 260-query capacity still untested. The duplicate-key guard was also exercised in UAT. See the [release record](../evidence/2026-09-17/uat-monitor/README.md) and [activation readback](../evidence/2026-09-17/uat-monitor/activation-readback.json). Automated checks: 232 tests, typecheck and build passed.
