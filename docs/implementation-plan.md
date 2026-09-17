# Implementation Plan

Status: planned work, not completed features. This plan implements [the detailed design](design.md). Repository documentation and code comments use English; collected source text retains its original language.

## Milestone 0 — Verify the browser surface

Deliver a small local Chrome probe for 3–5 keywords. Inspect the current results list, ad label ownership, internal scrolling, empty/blocked states, and screenshot legibility. Record browser/version/profile details and the supported layout signatures.

Acceptance: actual PNGs and observation logs are manually reconciled with the visible page. Do not declare an ad classifier validated solely because no ad appeared. Produce synthetic or sanitized fixtures for cases missing from the live run. A reliable classifier and list model are prerequisites for assigning automatic rankings.

## Milestone 1 — Contracts and deterministic core

Reconcile the preliminary TypeScript contracts with the design's attempt, observation, skipped-state, and persistence fields. Add runtime validation for config and output. Implement naming, overlap reconciliation, ranking, JSON/CSV exports, and output-budget checks independently of browser automation.

Required cases:

- Ad at the top and in the middle; unknown classification invalidates only affected organic ranks.
- One business has both an ad and an organic occurrence; same-name businesses remain separate.
- Overlapping viewport observations do not double-count cards.
- Ambiguous overlap or a reorder preserves the verified prefix and raw evidence without inventing positions.
- Filenames handle Unicode, path characters, long queries, repeated input rows, and collisions.
- CSV escapes external text safely while JSON preserves original values.
- No-results, partial, blocked, skipped, and failed outcomes remain distinct.

Acceptance: deterministic fixture tests pass and serialized examples validate against the executable contract. No live browser or cluster is needed for these tests.

## Milestone 2 — Local collector

Implement the planned CLI, Chrome lifecycle, Maps adapter, bounded scrolling, screenshot consistency checks, query-attempt isolation, and local output manifests. Implement the agreed English desktop profile first; unsupported layouts are explicit outcomes.

Proposed command interface, not currently available:

```bash
npm run capture -- --config examples/keywords.json
npm run capture -- --config examples/keywords.json --keywords-file keywords.csv
```

Acceptance: the probe keywords produce reviewable raw screenshots and CSV/JSON with matching query/ordering evidence. Every input has a terminal result. Demonstrate one controlled timeout and clean process shutdown. Clearly identify local-only persistence.

## Milestone 3 — Durable artifacts

Confirm the existing storage provider and implement only that provider first, behind a small storage interface. Add scoped credential handling, immutable attempt prefixes, per-query checkpoints, independent checksum readback, artifact index, and final manifest publication.

Acceptance: uploaded PNG/JSON/CSV artifacts independently read back with matching bytes; interrupted uploads do not create a verified completion; different worker attempts cannot overwrite each other. The manifest and logs do not expose credentials or signed URLs.

## Milestone 4 — Container and target Job

Build the dedicated Chrome image, record its browser version, and add a manual Job template with explicit CPU, memory, disk, shared-memory, deadline, and cleanup settings. Keep `backoffLimit: 0` initially and use the application's bounded retry rules.

Acceptance: run the same 3–5 keyword probe in the actual namespace, verify sandbox compatibility, screenshot rendering, network behavior, storage readback, timeout/SIGTERM cleanup, and evidence access after Pod deletion. Measure resources and tune proposed limits before a larger batch.

No cluster deployment is implied by writing the template. Registry, namespace, image digest, and storage identity must be resolved from the actual environment before applying it.

## Milestone 5 — Initial operational batch

Run up to 20 requested keywords. Review the summary of captured, partial, blocked, failed, and skipped queries, including unknown classifications and persistence failures. Reconcile a sample of structured results against screenshots and inspect every exceptional outcome.

Acceptance: all requested queries are accounted for, all declared successful evidence verifies, and operational limitations are documented. A CAPTCHA-blocked batch is a valid diagnostic outcome, not successful keyword coverage.

## Later work

- Scheduled Jobs and an explicit run launcher/controller with retry/resume policy.
- Additional locale adapters and separately measured browser profiles.
- A read-only results viewer and business association across keyword runs.
- Report annotations derived from raw screenshots, with evidence links.
- Historical comparison with profile compatibility checks and clear non-observation semantics.

Do not add these before reliable capture, classification, ordering, and persistence are demonstrated.
