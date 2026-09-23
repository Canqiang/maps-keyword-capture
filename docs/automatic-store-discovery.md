# Automatic UAT store discovery

## Objective

A newly onboarded store with linked keywords should join the next daily capture without editing the monitor config. Existing stores must refresh keywords every day. Preserve the Beijing midnight schedule, keyword text and priority policy, query-only geography, evidence contracts and stable historical prefixes.

## Data flow

1. CronJob creates a Job/Pod at 00:00 Asia/Shanghai.
2. The monitor acquires the date claim. An existing claim exits as `duplicate_skipped` before discovery.
3. A bounded read-only Mongo projection reads `seo-integration.local_keywords`. Validate identities, preserve configured historical aliases, derive stable IDs for new places, and record exclusions.
4. Persist the frozen registry snapshot and its receipt, then checkpoint the daily manifest.
5. For every discovered place, GET the existing keyword API and validate its exact merchant/place identity. Persist a selection snapshot, retaining priority P0–P3, stable source order, exact-text deduplication, and the 40-word cap.
6. Capture batches of up to 20, preserving listings including marked ads, JSON/CSV/screenshots and observations in Azure.
7. Publish the final daily manifest with actual dynamic denominators and separate execution/ranking outcomes.

## Configuration and compatibility

`storeDiscovery` is optional for backward compatibility. Without it, the explicit `stores` list is required and retains static behavior. With it, `stores` may be empty and is only an alias/reference-area map. It never supplies a fallback or allowlist. UAT enables provider `mongo`, database `seo-integration`, collection `local_keywords`, 30-second timeout, 10,000-record scan bound and 40-store dispatch bound. Exceeding bounds fails without truncation. Connection details remain in `KEYWORD_MONGO_URI`, excluded from Chromium and evidence.

Discovery includes linked, named records with a nonempty keyword array. Legacy unlinked or empty records are explicitly excluded. The backend has no keyword-record enabled/deleted flag; no invented status policy or mandatory restaurant-location join is applied. Duplicate canonical identities and alias ownership conflicts fail closed. A rename preserves the ID; new place identities produce new deterministic IDs. Registry source hash and config hash are distinct.

## Failure and evidence rules

Discovery failure must produce an accurate terminal outcome and dispatch no keyword reads or browser work. A storage failure while saving discovery/checkpoints also prevents dispatch. Empty discovery is not successful coverage. The registry snapshot and its exact receipt join the existing claim, selection snapshots, batch manifests and artifacts; historical manifests remain readable without a registry field. Late source edits apply on the following cycle; cross-store API reads are fresh sequential reads, not one atomic database transaction.

## Verification scope

Unit tests cover adding/removing stores, stable aliases/renames, identity conflicts, bounded reads/cancellation, empty/failure cases, claim ordering and persistence before dispatch. A UAT smoke exercises the real discovered roster, per-place source reads, browser capture and independent Azure-login readback. A two-word-per-store smoke does not prove full 300-query or 40-store throughput. Release evidence records actual identities, denominator, results and deployment readback.
