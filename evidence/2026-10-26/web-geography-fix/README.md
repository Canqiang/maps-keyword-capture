# Web location preparation repair — October 26, 2026

Status at the initial implementation commit: **code and tests complete; isolated live verification in progress; production unchanged**.

- Diagnosis: the same-pod four-way comparison separates URL camera position, browser GPS and search submission order. Only map-home + acknowledged GPS + subsequent UI search returned the expected Garden City-area result set for the tested OnlyBear 3 km query.
- Repair: opt-in `located_ui`, origin-scoped permission, GPS/UI/camera receipts, one submission, fail-closed preparation, preserved ads/order, separate comparison profile.
- TDD evidence: preparation/profile/config tests initially failed against the old workflow. A post-submit crash reproduced a retry request; a removed input reproduced an unbounded read. Both regressions now pass.
- Independent code review found those two boundedness/retry issues; both were fixed and re-reviewed. No remaining important finding in the reviewed scope.
- Full local validation: **102 test files / 1,931 tests passed**, including TypeScript contract checks. Focused suites: 23 tests passed.
- Live first-stage scope: 10 searches — OnlyBear two near-me terms at three fixed points, Keke two center terms, UWS one center term and SEE JOY one center term. This uses a compiled working-tree overlay in a dedicated no-secret Pod, not a released image, production database write or Azure delivery acceptance.
- All existing collector/deployment/configuration fingerprints were saved before the probe. Final drift comparison and image-level validation remain pending at this commit.

Local working evidence: `/tmp/maps-web-geography-20261026` (to be copied into the task's durable evidence directory). The working-tree overlay's archive digest and base image are recorded in `candidate-provenance.json`; it must not be represented as an immutable production image.

Operational contract and remaining geography/filter/capacity limitations: [Web GPS-first search preparation](../../../docs/web-located-search.md).
