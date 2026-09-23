# Automatic store discovery — UAT release

## Scope

User-authorized daily database enrollment replaces the fixed seven-store roster. The keyword cap (40/store), Beijing midnight schedule, query text, query-only geography, browser profile, artifact contract and Dev/production workloads remain unchanged. A read-only source inventory on 2026-09-23 found 13 keyword records: eight linked eligible stores and five unlinked legacy records. SEE JOY 喜聚 is new relative to the fixed roster and has 43 keywords; the full current roster implies up to 300 queries / 15 batches.

## Local verification

The implementation preserves seven historical storage IDs, derives stable IDs for new places, saves a verified daily registry before source/browser work, and fails explicitly for ambiguous/incomplete discovery without stale fallback. Focused red/green tests cover new enrollment, rename/removal, alias/ownership conflicts, source bounds/timeouts/cancellation, connection cleanup, credential isolation, empty source and claim/storage ordering. Independent code review found no blocking issues; 122 focused tests passed. The full settled tree passed typecheck, 422 tests across 36 files, and build. Live release results will be recorded below before delivery.

## Live acceptance

Pending new image build and a unique manual UAT smoke with two keywords per freshly discovered store (expected eight stores / 16 queries). No claim of full 300-query acceptance or future midnight execution is made by that smoke. Existing daily image/config remain in place until the smoke and independent Azure-login evidence verification pass. The unrelated dirty deploy/cronjob/README.md is preserved.
