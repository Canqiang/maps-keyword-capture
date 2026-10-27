# UI absence wording and geography annotations — 2026-10-27

## Scope

User requested a single **未见** label, capture-scope clarification and visible
unverified geography. This release changes only frontend presentation. It does
not alter eligibility, rank or metric arithmetic, captures, keywords, historical
records, resource limits, or schedules. See `docs/ui-rank-status-labels.md`.

## Validation

- Initial regression tests failed against the previous presentation as expected.
- Full suite at default concurrency: 1,957 passed, two timing-sensitive Android
  tests failed (gesture deadline and optional OCR reread deadline).
- Both affected files passed in isolation: 240 tests.
- Full suite with two workers: **104 files / 1,959 tests passed**.
- Final UI follow-up (including comparison selector layout): **42 focused tests
  passed**. Typecheck, contract checks and build passed.
- Browser QA rendered the actual UI with 57 archived OnlyBear observations:
  overview, date matrix, evidence and 390px mobile evidence layout passed. It did
  not revalidate historical Maps screenshots or claim present-day rankings.

## UAT release

- Deployment: `uat/maps-tracking-ui`, context `FBRDevAKSCluster`.
- Cloud ACR build: `ch15kq`, independently read as Succeeded.
- Image: `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:97bf4d7a4df65922ec99aaa1e6a2330a711bb0f9d11d03b4544896b242854abb`.
- Source: working-tree snapshot on base `60b873064b6e4a1e7d74e1ea1c8a7295b9916e55`,
  source manifest hash `eb91fc111c0a2197665b3a857039f7650945c4376bfd386b1b115dd9a527d868`.
  This is not a claim that the new changes were committed or pushed.
- Only the UI container image was patched, with UID/spec compare-and-swap guards.
- Ready Pod actual imageID matched the pinned digest, with zero restarts.
- Served HTTPS HTML matched the tested local build byte-for-byte.
- Authenticated readback returned 44 OnlyBear observations across three points.
- All seven Maps CronJob spec hashes were unchanged. All three active collector
  Pod identities, actual images and restart counts were preserved.

Local evidence (source snapshot, build receipt, before/after runtime records,
regression logs and browser screenshots):
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/ui-absence-labels-2026-10-27`.

## Final public-surface check

Authenticated, read-only browser checks passed against the live UAT overview
and an exact persisted absence evidence record. Geographic uncertainty was
visible before expanding technical details. No page JavaScript errors occurred.
The latest-day overview had numerical ranks for the selected keyword, so the
absence detail check selected a real October 26 record rather than inventing
an absent latest result. Live screenshot evidence is retained locally.
