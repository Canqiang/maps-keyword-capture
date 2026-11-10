# Web evidence and competitor trends — UAT release, 2026-11-10

Source commit: `25fcf73caf090053f4902185161b98cddfd6d48a`.
ACR build: `ch1675`; immutable image: `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:a40597d94ea088ce1dc5a9c5153a16ee6f52f07a54b05a57cef047a703ae8872`.

Normal screenshots now require the target store's organic rank to be in the top 10. Ads do not trigger them; exceptions retain bounded diagnostic screenshots. Structured ranking data remains available when images are omitted. Existing history is preserved. The UI and ingest consumers understand deliberate screenshot omission.

The authenticated UAT UI exposes competitor natural-rank, SoLV, ARP and ATRP trends with line/bar and per-round/daily-last controls. It compares the same keyword and fixed-point scope, separates incompatible profiles, preserves missing evidence as gaps and never invents ATRP from truncated results. Loading is bounded; evidence images use private conditional caching. These are fixed-point sample metrics, not full geographical coverage.

## Validation

Fresh typecheck, contract compilation, build and 1,997 tests across 111 files passed. GitHub checks passed (run 42785522012). The isolated immutable-image probe used three existing words at existing KEKE/OnlyBear center points, a memory observation sink (no production Mongo writes), and a unique Azure scan prefix. Original Pod exit 0, zero restarts; three captured lists and 45 reconciled JSON/CSV rows. One absent target produced zero PNGs; two organic-rank-1 results produced one PNG each. Both actual PNGs were viewed. Full referenced-artifact readback independently used Azure CLI login: 18 downloaded objects, 15 writer size/SHA verified; the scan root was compared with its terminal summary and two progress manifests have no writer SHA. This is not full scheduled-round acceptance.

The UAT UI rolled out successfully; public health and authenticated competitor API returned 200, the real OnlyBear competitor chart rendered 36 observations across three fixed points, and the browser reported no page errors. Screenshot sampling does not establish backend geographic locality.

## Deployment and protected scope

Only Maps UI and the future Web-target, daily, extra-daily and daily-ingest CronJob images/IMAGE_DIGEST were changed. Each mutation tested original UID/resourceVersion/spec and its result was independently read back. Schedules, points, keywords, ConfigMap references, resources and existing Job specs were preserved. Android remains suspended; no node pool changes, history deletion or shared SEO edits. Environment repository changes are limited to the five corresponding Maps image manifests. Generic manifests containing explicit REPLACE placeholders remain templates, not live deployment instructions.

Raw release evidence remains under `web-optimization-2026-11-10/release` in the local session evidence directory. See `release.json` for exact probe scope. Do not infer success of all daily schedules from this small release verification. Future full scheduled rounds require their own coverage and terminal-exit checks.

## Deployment-template regression check

The first release-metadata CI run (42787363657) found one failure out of 1,997 tests: the legacy `deploy/tracking-ui` template was updated while its paired suspended `deploy/tracking-web` template retained its old image. Neither template is the live UAT deployment source. Restored the legacy UI template rather than changing paused collector configuration or weakening its contract test. The actual UAT UI image remains pinned in the environment repository and independently read back. Runtime source and the verified immutable image are unchanged.
