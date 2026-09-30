# Limited place-details recognition — v6

## Problem and resulting behavior

The September 29 and September 30 automatic UAT runs queried `see joy`. Google opened **She-Joy's Sweet Treats**, a different business, in a limited place-details view with Save, Send to phone, Share and website/phone controls, but no Directions or address action. The previous detector returned `partial / unsupported_layout` because it required those latter actions.

The v6 detector recognizes this loaded layout using visible controls owned by the named detail pane, with a trusted Google place URL. It records optional `quality.placeDetails` evidence: actual name, Maps URL, recognition method and observed signals. It preserves the original keyword and the observed query text. Detail-only responses retain `partial / non_ranking_result`, zero listings, a header-only CSV and diagnostic PNG; complete persisted evidence satisfies execution completion. A detail page does not imply rank 1 or an own-store match. No keyword or location rewrite was made.

URL or heading alone remains insufficient. CAPTCHA/consent and visible feeds retain precedence. Hidden, disabled, loading, unrelated-pane, malformed phone and deceptive URL controls are rejected. Standard detail pages remain supported. A feed that later becomes a detail can retain its captured prefix, but remains incomplete. The separately observed `float` priced/no-Directions House variant is outside this release and remains unresolved.

## Local validation

- Node 24.14.0: typecheck, build and all **566 tests in 42 files passed**.
- Limited-detail browser/query regressions were first observed failing and then passed; the focused suite contains 54 tests.
- Independent runtime review: no remaining findings, including execution through the real `tsx` serialization path.
- The standalone Azure verifier passed **110 offline tests** and independent review. It verifies all attempts, the original query/config/profile, runtime identity, receipts, CSV values, PNG structure, observation coverage and valid v6 detail signals. It explicitly distinguishes a missing regression observation from acceptance.
- Launcher and promotion guards passed mocked drift/repeat/CAS tests. Promotion changes only the image and IMAGE_DIGEST.

`dom-source-provenance.json` binds the direct-URL DOM/PNG used to reconstruct the regression fixture. This direct navigation is not a fresh keyword search. The UAT smoke below is fresh keyword-search evidence.

## Fresh UAT smoke, September 30

Runtime commit: `f7ce5808418e77a1a94a5ca02bff4288012e3bbe`.
Adapter: `maps-feed-card/v6`.
Image digest: `sha256:4af2e7cca2eae8d0a03fa598cb3b28cb6ffb3cd37d8f48011beb7553e2ce1652`.
ACR build: `ch14jd`.

Job `maps-detail-smoke-20260930t01501790704257z-6579` ran the standalone collector using the daily capture profile and 250m CPU request. The Pod ran **09:51:04–09:51:34 Asia/Shanghai**, exited **0** without restarts, and used the expected immutable image. The Job completed at 09:51:37.

| Input keyword | Actual result | Outcome |
|---|---|---|
| `see joy` | She-Joy's Sweet Treats, limited detail | Recognized non-ranking detail; actual different merchant retained |
| `SEE JOY 喜聚` | SEE JOY 喜聚, standard detail | Recognized non-ranking detail; no ranked list |
| `bubble tea mineola` | Six businesses in a results list | Captured; six organic rows and end-of-list evidence |
| `Flushing` | Flushing, Queens geographic detail | Recognized non-ranking detail; no merchant rank |

The batch ranking status remains `partial` with three non-ranking results, while `executionStatus=completed` and the original Pod exit is 0. Independent Azure CLI login readback verified **19/19 objects: one manifest plus all 18 artifacts**, including byte sizes/SHA-256, all four JSON/CSV pairs, six CSV listing rows, two observation records, and all five PNG structures. All **five PNGs across all four queries were actually viewed**; visible names, controls and listing order matched the structured data. No ad/unknown examples were present; this smoke does not establish ad-classifier coverage. Geography remains unverified.

Azure account/container: `fbrdevstorage / maps-keyword-capture-uat`.
Manifest: `2026-09-30/run_20260930T015105Z_52b953/att_215e9734/manifest.json`.

## Deployment and scope

At **2026-09-30 09:54:12 Asia/Shanghai**, the existing `uat/maps-keyword-monitor-daily` CronJob was promoted to the verified v6 image by a UID/resourceVersion/spec-guarded patch. Only `image` and `IMAGE_DIGEST` changed. The enabled `0 0 * * *` / Asia/Shanghai schedule, ConfigMap, source discovery, George exclusion, resources and capture settings were preserved. An independent reviewer freshly read the live CronJob/ConfigMap/Jobs and smoke Pod, confirmed the exact two-field change and exit 0, and independently rehashed all 19 locally downloaded Azure objects. This four-query smoke is not a full 350-query nightly rerun; historical results and original exit codes are unchanged.

## Previous nightly state

| Beijing date | Selected / attempted | Nonempty ranked | Explicit no-results | Recognized non-ranking | Other partial | Pod exit |
|---|---:|---:|---:|---:|---:|---:|
| September 29 | 350 / 350 | 319 | 2 | 27 | 2 (`float`, `see joy`) | 2 |
| September 30 | 350 / 350 | 318 | 2 | 29 | 1 (`see joy`) | 2 |

Both runs automatically triggered and covered all ten eligible stores, including newly discovered merchants; George remained excluded. Neither run was fully successful. Both explicit no-results queries were Keke `luwei` and `cold dishes`. `float` succeeded on September 30, but that does not prove its intermittent housing-card variant is fixed.

Nightly status checks independently validated each run's 29 referenced manifests/snapshots and targeted artifact samples; they did **not** hash every nightly artifact. September 30's available final log receipt also matched the downloaded daily manifest. The detailed scopes and original runtime evidence are recorded in `nightly-status-summary.json`. No customer-local ranking or enrolled-merchant identity is established merely by persistence or keyword similarity.
