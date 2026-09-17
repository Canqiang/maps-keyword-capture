# Validation status

Updated 2026-09-17. This page distinguishes recovered historical evidence, compile-time checks, and unfinished runtime acceptance. No collector, runtime schema validator, container image, storage adapter, or deployed Job exists yet.

## Evidence ledger

| Item | Current evidence | Status / outstanding work |
|---|---|---|
| Chrome versus bundled Chromium | Original probe scripts and centered-map PNG sequences | Local rendering samples only; Linux/Pod equivalence unvalidated |
| Sponsored placement | Gong Cha label visible in `ad_shot_00.png`; matching business details appear later in `ad_shot_02.png` | Supports preserving both appearances; does not validate label ownership or all organic classifications |
| DOM stride, dimensions, label depth, exact browser version | Historical notes and inspection scripts | Raw DOM/stdout not recovered; reproduce with saved logs before treating as parser acceptance |
| Query-only input | `qonly.mjs` constructs a query URL without a center/zoom; three first-screen PNGs recovered | No complete scrolling/evidence sequence; not target-Pod acceptance |
| Geographic meaning | Garden City and Matcha samples show broad map extents and differing geographic signals | Review geographic ambiguity; preserve query text, never force a preferred city silently |
| 15 listings within 6 scrolls / 5 results screenshots | Prior estimates from centered-map probes | Provisional operational budgets; exhausted coverage must be partial |
| Contract shape | `src/contracts.ts`, `tests/contracts.type-test.ts` | Compile-time constraints covered; external JSON and cross-field relationships still need runtime validators |
| Empty, consent, CAPTCHA, second ad layout | No recovered samples | Missing fixtures and runtime evidence |
| Sandboxed Chromium in target Pod | No recovered evidence; scripts do not explicitly enable sandbox | Startup, resource use, timeout/SIGTERM, and query-only batch acceptance outstanding |
| Azure persistence | Design only | Upload plus independent byte/hash/image readback and final manifest receipt outstanding |

See the [evidence archive](../evidence/2026-09-17/README.md) and its [inventory](../evidence/2026-09-17/inventory.json) for original files and hashes. Source modification times are not browser capture timestamps. No recovered PNG is promoted to a structured, verified ranking result.

## Contract checks

```bash
npm run typecheck
npm test
```

The contract suite covers paid/unknown rank exclusions, success versus exhausted budgets, skipped input accounting, readback fields required by verified artifacts, attempt identity, evidence binding, and configured versus observed location. The tests were first run against the old contracts and failed before the missing shapes and constraints were added.

These checks do not launch Chromium, validate external JSON, or prove business behavior. Runtime acceptance must validate numeric ranges, hashes/timestamps, unknown configuration fields and reserved `mapView`, prefix continuity, classification evidence ownership, image coverage, artifact/attempt references, and the manifest's selected-attempt policy. In particular, a captured result requires all emitted cards to have supported classification and complete screenshot coverage. Storage status remains separate from collection quality.

## Next acceptance gate

Build the runtime validator and deterministic fixtures, then implement the bounded collector. Re-run the three original keywords in the target Pod under the recorded query-only profile, inspect returned areas without changing queries, save raw observations and complete screenshot sequences, and measure budgets. Exercise missing layouts and failure states. Then verify Azure delivery and access after Pod deletion. Do not treat a successful probe exit or uploaded blob as completed acceptance.
