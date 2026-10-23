# Current code review — 2026-10-23

Reviewed source: `2841b33c7fc4bd47f0a3b92c4401f0de8590d086` (`main`, equal to freshly fetched `origin/main`). The worktree was clean before this review. The previous repair branch is already merged. This is a source review and local verification, not a live UAT deployment or runtime acceptance check.

## Findings

### P1 — Bottom-edge correction can preserve an organic rank despite new explicit ad evidence

Location: `src/android/screen-reader.ts:667-675` and the `placed` update at lines 710-720.

The bottom-edge branch matches by position and name, bypassing the result-type conflict check used by normal geometric placement. When an existing organic row is joined to a subsequent explicitly sponsored card, the update changes rating/reviews but only replaces classification if the old type was `unknown`. It therefore keeps `organic`, assigns an organic rank and reports `rankingReliable: true` despite contradictory ad evidence.

Local reproduction used the existing candidate12 q0004 frames 25/26 fixture. The second card was changed to `ad`, with `Sponsored` and `native_ad_label_confirmed`; all other geometry/evidence remained unchanged. The reconciler returned Zhang Liang as organic rank 2, two frame references, no warnings, reliable=true. This is a counterexample to the reconciliation contract, not a claim that this conflict occurred in a historical live capture.

Required effect: edge corrections must enforce classification compatibility. Explicit ad/organic contradictions must invalidate ranking or be resolved from sufficient occurrence evidence, never silently preserve the old natural rank. Add both ad-to-organic and organic-to-ad negative regression cases.

### P1 — Independently read mutable store catalogs can overlap or omit balanced shards

Location: `src/domain/cli.ts:210-212`, `src/domain/tracking-config.ts:160-185`; Android CronJob uses two balanced shards without a pinned catalog.

Each worker loads Mongo stores after its own emulator becomes ready. Worker 1 now deliberately waits 180 seconds before booting. A settings change between the two reads can change balanced assignment. Each worker is internally consistent, but their union is not guaranteed to cover one common catalog exactly once.

Local reproduction: three stores A/B/C with 10/9/8 keywords. Worker 0 takes A. Before worker 1 reads, A changes to eight keywords; worker 1 then takes A and C. A is duplicated and B is omitted. No database or cluster changes were made for this reproduction.

Required effect: read the current library/settings once per collection round, persist an immutable snapshot and shard assignment, and make every worker consume that same snapshot/hash. Subsequent settings edits take effect next round. Keep daily source refresh; freeze only within a round.

### P2 — Concurrent manual trigger requests can launch duplicate Jobs

Location: `src/web/scan-trigger.ts:107-118`.

The active-job check is a list-then-create operation. Two requests can both see an empty list and create different random Job names. Local mocked concurrent calls to `trigger('web')` produced two successful Job creations. These standalone Jobs also have no CronJob owner reference, so the CronJob's Forbid policy is not a shared lock with the manual-trigger path.

Required effect: use a shared atomic claim/idempotency mechanism for a target's active run, covering manual and scheduled launch paths. An in-memory UI mutex alone will not cover replicas or a scheduler race. Retain the user's ability to trigger after the prior run finishes.

## Progress and limits

- Android listing method is now v18 (candidate15), with split rating-line recovery, additional clipped-header/geometry cases, photo-module support and explicit ad-owner handling.
- Two emulator workers have separate runtime directories and now stagger cold boots. Scheduler resource fit is not evidence of full-round throughput.
- The checked-in Android configuration now says daily (`everyHours: 24`, CronJob `0 21 * * *`, America/New_York); Web remains every two hours. Android template is suspended and contains a digest placeholder. These files do not establish live deployment state.
- Historical handoff evidence reports probe14 completing 4/5 queries and the first Only Bear scheduled-template manual verification completing 27 observations with partial results. Those historical results must not be described as candidate15 live acceptance.
- No application source, schedules, cluster resources, shared SEO data or historical observations were changed by this review.

## Verification

- TypeScript typecheck: passed.
- Python Android runtime tests: 30/30 passed.
- Full npm contract/unit tests: 1,638/1,638 passed across 85 files (105.08 seconds). Existing passing tests do not cover the three counterexamples above.
- Three focused reproductions above ran directly against this source with local fixtures/mocked APIs; no real collection was triggered.

## Repair follow-up

All three findings are addressed in the local repair branch. See [the implementation and handoff](../scan-consistency-handoff.md) for contracts, regression coverage, recovery and rollout requirements. Independent review additionally caught the intermediate-unknown classification case and unsafe gate release on cleanup failure; both were included in the repair. Runtime snapshot validation now also binds the full configuration and shard execution identity.

The baseline output above is historical, not a post-repair result. `2026-10-23-baseline-reproduce.ts.txt` preserves the original script for the reviewed baseline; use the regression tests for the repaired source. Correction to the schedule summary above: the current target Web template is every three hours, while the legacy Web template remains every two hours. Neither statement establishes live cluster state.
