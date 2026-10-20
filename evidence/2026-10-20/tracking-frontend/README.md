# Real-data tracking frontend validation — 2026-10-20

The approved interface is implemented with merchant overview, keyword/date history, exact original screenshot sequences, before/after comparison, separate Web and Android surfaces, and surrounding-point history. It is locally verified and has not been deployed or pushed.

## Implementation and safety

The additive API supports stable scoped timeline pagination, exact observation ownership, point discovery, and historical grid-run selection. The UI retains failed latest attempts and missing days, separates display order from organic rank, and suppresses changes across incompatible location/profile cohorts. Explicit uncollected points remain empty instead of silently selecting the center. Historical-keyword navigation is preserved when opening and returning from evidence.

The snapshot preview binds only to localhost, uses an in-memory read-only repository, and rejects configuration writes. It does not connect to Mongo or create indexes. The original-image reader accepts only indexed PNG keys and verifies exact byte count and SHA-256. Optional Azure reads use the existing CLI login and may fill the explicitly indexed local cache, without any remote write.

Existing collector/Android execution code, dependencies and deployment configuration are unchanged from `fd6f5d5`. The canonical checkout remained clean at `cac847388f47015a6c1555c7d9e38a76b57ddbe1`. The domain CLI's nullable-center boundary validates stored configuration before constructing a plan; it does not alter valid capture behavior.

## Actual preview coverage

- 10 merchants and 7,263 retained observations: 7,029 historical Web, 186 additional October 20 Keke Web observations, and 48 Android pilot observations.
- 26,232 original screenshot receipt mappings. Images are fetched from existing local evidence or exact allowlisted Azure keys; no reconstructed or substitute screenshots.
- Display dates use `America/New_York`. Most archived Web records end on October 14 in that timezone (October 15 Beijing collection); Keke includes October 20. Catalogs are dated snapshots, not a claim about today's live roster.
- Real point evidence comprises Web center/unspecified-search records and two Android pilot locations. No verified regular surrounding grid exists in this retained data. The point view shows the available coordinates and histories; unknown positions are not plotted as captured locations. Historical grid logic is covered with fixtures, separately from real-data acceptance.
- Android pilot screenshots can be inspected, but their incomplete legacy quality evidence is not promoted to qualified natural rankings. No causal SEO or customer-local ranking claim is made.

Private source snapshots, image caches and row-level readback reports are retained outside Git in this task's `frontend-implementation-20261020` artifact directory. Reproduction instructions are in `docs/tracking-frontend.md`.

## Verification

`npm run typecheck`, `npm run build` and contract type tests passed. The final bounded full suite passed **59 files / 1,236 tests**, using `npx vitest run --maxWorkers 2`. The initial unrestricted full suite had one timing-sensitive failure in an unchanged Android blank-home preparation test (1,235 passed). Its isolated suite then passed 128/128, and the bounded complete rerun passed. This is recorded rather than treating the first attempt as a clean pass.

All **7,263 observations** were independently read through **79 paginated HTTP responses**, across 12 merchant/surface/point groups, matching identity, ownership, date, raw rank and exact screenshot references against the normalized snapshot. The snapshot also passed unique-ID, timezone, coordinate, evidence-index and no-fabricated-grid checks.

Image receipt checks covered 32 local archive samples, 29 selected live sequence PNGs, and 12 per-group HTTP PNG samples. These sets may overlap. This is **not** a full hash or visual review of all 26,232 mapped PNGs. Every requested image is verified by the reader before delivery.

Browser checks covered the actual Keke Web date matrix and Oct14/Oct20 original-image comparison, Keke and SEE JOY Android pilot pages and native Maps screenshots, exact point-history navigation, an explicitly uncollected point, and a 390px viewport. Mobile history and point pages both had document width equal to viewport width. Full Android image sequences remain available (54 and 40 images); lazy images reserve space instead of fetching the entire sequence at once.

Independent review found and resolved two navigation issues (uncollected-point fallback and lost historical-keyword scope). Rereview and final protected-file/credential-scope checks passed. See `validation.json` for the machine-readable scope. Raw test logs are local ignored files in this directory.
