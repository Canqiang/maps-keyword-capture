# Automatic store discovery — UAT release

## Scope

User-authorized daily database enrollment replaces the fixed seven-store roster. The keyword cap (40/store), Beijing midnight schedule, query text, query-only geography, browser profile, artifact contract and Dev/production workloads remain unchanged. A read-only source inventory on 2026-09-23 found 13 keyword records: eight linked eligible stores and five unlinked legacy records. SEE JOY 喜聚 is new relative to the fixed roster and has 43 keywords; the full current roster implies up to 300 queries / 15 batches.

## Local verification

The implementation preserves seven historical storage IDs, derives stable IDs for new places, saves a verified daily registry before source/browser work, and fails explicitly for ambiguous/incomplete discovery without stale fallback. Focused red/green tests cover new enrollment, rename/removal, alias/ownership conflicts, source bounds/timeouts/cancellation, connection cleanup, credential isolation, empty source and claim/storage ordering. Independent code review found no blocking issues; 122 focused tests passed. The full settled tree passed typecheck, 422 tests across 36 files, and build. Live release results will be recorded below before delivery.

## Live acceptance

Pending new image build and a unique manual UAT smoke with two keywords per freshly discovered store (expected eight stores / 16 queries). No claim of full 300-query acceptance or future midnight execution is made by that smoke. Existing daily image/config remain in place until the smoke and independent Azure-login evidence verification pass. The unrelated dirty deploy/cronjob/README.md is preserved.

## Live source probe and release blocker

The compiled new registry and existing keyword reader were exercised against the real UAT Mongo database/API through loopback port forwards. All eight sources read successfully: 13 records fetched, eight enrolled, five unlinked exclusions, 300 selected keywords and 15 batches. SEE JOY joined with its derived stable ID and 40 of 43 available words. The probe performed no browser capture or Azure writes. See `live-source-probe.json` and `live-source-registry.json`.

ACR build submission was blocked by Azure CLI `AADSTS700082` (expired refresh token). The user was asked to reauthenticate. No image build was queued and no UAT Secret, ConfigMap, Job or CronJob was changed by this release. The active daily workload still uses its prior static roster until this release passes live smoke/readback and is promoted. The independent dynamic-roster readback verifier is prepared and reviewed locally: 37 offline tests pass, retaining all 24 historical checks. Runtime source intended for the new image is commit `e613fbf`.

Resume with authenticated Azure CLI: build the exact code commit, create the unique 2-word/store smoke, verify its actual discovered denominator and all stored evidence, pin the image, update only UAT discovery config/image/source reference while preserving the enabled midnight schedule, then independently read back and merge release evidence.
