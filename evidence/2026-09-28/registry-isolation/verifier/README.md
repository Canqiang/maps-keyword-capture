# UAT registry-quarantine v5 retest: independent evidence verifier

This September 28 retest helper is a separate copy of the reviewed September 28
registry-quarantine v4 verifier.
Historical helpers and their evidence remain unchanged. The runtime adapter is now
`maps-feed-card/v5`, adding strict House and Lodging card compatibility. This
helper changes only the accepted adapter version and its provenance error text;
the reviewed registry/exclusion/quarantine and artifact contracts remain intact.
Existing batch, query-attempt, JSON/CSV, observation, screenshot,
ranking-status, execution-status and remote-receipt checks are preserved.

The live source probe found 18 keyword records, 10 eligible stores, eight
intentional/invalid-identity exclusions and zero quarantined records. Exact
George place exclusion is user-authorized because George is a test store.
Nil merchant UUIDs are invalid, which excludes the PROBE_ONLY source record.
The three new merchants are Royal Queen, CONNEXION SPA and Szechuan Opera.
The source-level production selection was 350 words in 18 batches. A capped
release smoke is a separate run; its persisted selection snapshots determine
its denominator. It is not evidence that all 350 words were captured.

## Run after the release smoke has terminated

Use the exact final Pod log, launch config, image digest and full runtime commit.
The example assumes a two-word-per-store smoke; use the actual configured cap.

```sh
python3 verify_daily.py \
  --log ../pod.log \
  --out ../readback \
  --digest 'sha256:ACTUAL_BUILT_IMAGE_DIGEST' \
  --source-commit 'ACTUAL_FULL_RUNTIME_COMMIT' \
  --adapter-version maps-feed-card/v5 \
  --expected-config ../smoke-monitor.json \
  --expected-stores 10 \
  --max-keywords 2 \
  --workers 6
```

`--summary` can replace `--log` with the exact terminal summary JSON. Check the
original Pod exit, actual imageID, run key and claim independently. This helper
performs no cluster actions and does not prove automatic scheduling.

## Registry release acceptance

- Download and verify the complete receipt chain using Azure CLI login, never
  the Pod SAS. Require a ready discovered registry and the exact launch config.
- Compare the terminal summary's full registry metadata with the daily manifest.
- Verify registry schema, date, run key, daily ID, namespace, UTC fetch timestamp,
  normalized-source hash format and the exact September 28 registry policy.
- Require the explicit four counts: `fetched`, `eligible`, `excluded` and
  `quarantined`. Reconcile records and rows; quarantined is a subset of excluded.
- Require explicit, matching empty `quarantines` arrays in both registry snapshot
  and daily metadata, plus `quarantined = 0`. Missing fields cannot mean zero.
- Reject any enrolled configured excluded place, nil merchant UUID, duplicate
  place/store ID, unsafe identity, invalid alias, invented area or unstable ID.
- Allow `configured_<reason>` only when that reason is explicitly present in the
  exact expected config's `storeDiscovery.excludedPlaces`. Reject fabricated
  reasons and unresolved quarantine reasons hidden in ordinary exclusions.
- Preserve the original safe-ID, capacity, alias and live-name checks.

This is intentionally a **ready, zero-quarantine release gate**. Runtime may
correctly continue other stores when an unresolved ownership group is quarantined
and return incomplete execution / exit 2. Such a run cannot pass this gate. A
not-ready rejection alone is not a new collector outage or proof of corrupt
artifacts; inspect its explicit registry outcome and original exit. This copy
is not a generic acceptance verifier for zero-store or unresolved-quarantine runs.

The persisted snapshot does not retain eligible source-document IDs or the
excluded row's place ID. Therefore it cannot independently reconstruct the
normalized source-response hash or prove each configured reason's mapping to a
source row. The separately saved read-only Mongo projection and replay provide
that source-level evidence for this release. Artifact byte-size and SHA-256
verification remains complete and separate from that limitation.

## Preserved artifact verification and visual scope

Every referenced daily/batch manifest, registry/selection snapshot and artifact
from every query attempt is downloaded with bounded concurrency and checked.
Provenance-aware caches cannot turn an offline replay into an Azure-login verdict.
JSON/CSV rows, attempt ownership, listing observations and PNG structures are
validated. The original static mode remains available for non-discovery runs.

`partial` with `executionStatus=completed` and exit 0 is allowed only for fully
evidenced recognized non-ranking details. Details have no rank. `nonRanking` is
a subset of `partial`; no-results pages are counted separately. Geography is
unverified without an independently verified expected area.

Outputs are `readback-report.json`, `object-inventory.json`,
`query-inventory.json` and `visual-samples.json`. Full hash checks and structural
PNG checks do not replace visual inspection. Inspect samples across all actual
stores and each partial reason and describe that smaller visual scope separately.

Exit 0 means evidence consistency and complete execution; exit 2 means verified
but incomplete execution; exit 1 means the acceptance contract was rejected.
Always preserve the original Pod exit independently.

## Offline validation

```sh
python3 -m unittest -v \
  test_verify_daily.py test_registry_verify.py \
  test_adapter_verify.py test_quarantine_verify.py
```

All **65 tests passed**: the original 24 artifact tests, 13 registry tests and
21 quarantine tests remain byte-identical to the reviewed September 28 helper.
Seven adapter tests validate v5 acceptance/defaults and reject v2/v3/v4/unknown
requests before readback, plus v3/v4 batch and result metadata with correctly
resigned receipts. The quarantine tests cover intentional exclusions,
fabricated reasons, excluded enrollment, nil identities, quarantine omissions,
hidden groups, malformed/subset counts, non-ready status and summary mismatches.

Relative to the reviewed September 28 v4 helper, only the adapter constant and
the version-specific error text in `verify` changed. Historical helpers remain
unmodified; the v4 first-smoke readback can continue independently.
`validation.json` records the helper SHA-256, preserved baseline hashes and scope.
`local-test-results-current.txt` is the current result. These are offline tests,
not a live-run verification verdict.

The artifact fixtures obtain the adapter from `v.ADAPTER`, so v5 fixtures retain
exactly the same JSON/CSV/PNG/receipt shapes. No new capture result is claimed
by these offline fixture tests.
