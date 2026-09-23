# UAT store-discovery v4 retest: independent daily evidence verifier

This is a new local copy of the reviewed September 19 v3 full-daily verifier.
The historical helper and its evidence have not been edited. The additions
validate the automatic store-discovery contract in the September 23 release.
They do not change the existing batch, query-attempt, JSON/CSV, screenshot,
observation, ranking-status, execution-status or remote-receipt checks.

This retest copy accepts only `maps-feed-card/v4`, including when the adapter
argument is omitted. The v4 apartment-card repair changes classification support;
the persisted artifact contract and all evidence checks remain unchanged. Explicit
v2/v3/unknown adapter requests, and v3 batch or result metadata within a v4 run,
are rejected even when their receipt hashes are valid. The original first-smoke
v3 helper and evidence remain unchanged in the parent release directory.

The release smoke is expected to discover **8 actual stores**, including the new
SEEJOY store, and select **at most 2 words per store**. The actual persisted
selection snapshots supply the denominator; 16 is an expectation, not a forced
outcome. The launch configuration's 7 stored aliases are not the enrolled roster.

## Run after the manual smoke has terminated

Supply the exact launch config, final Pod log, built image digest and full runtime
commit. Do not reuse a historical digest or infer a run from an old success.

```sh
python3 verify_daily.py \
  --summary ../accepted-smoke-summary.json \
  --out /tmp/maps-discovery-readback \
  --digest 'sha256:0f430d59eeac7106679448f3dd6ce385aed3b43dc71420d0c73d31cb1b43f2c0' \
  --source-commit 'a530fdb6d5e65ffb25943cf97dcb959aecb486fc' \
  --adapter-version maps-feed-card/v4 \
  --expected-config ../accepted-smoke-config.json \
  --expected-stores 8 \
  --max-keywords 2 \
  --workers 6
```

`--summary` can replace `--log` with the exact terminal summary JSON. The command above independently replays the archived accepted smoke. Supply new
identities/config and expected roster/cap for any later run; do not reuse these
values as proof of a future daily cycle.
Check the original Pod exit, imageID, actual run key and claim separately. This
helper performs no cluster actions and does not prove automatic scheduling.

## Registry checks

- Download `store-registry.json` using Azure CLI login, and verify its exact
  byte size and SHA-256 against the daily manifest receipt. Never use the Pod SAS.
- Require a ready discovered registry and exact launch discovery config. A
  missing registry cannot fall back to configured aliases.
- Validate registry schema, date, run key, daily run ID, snapshot namespace,
  fetch timestamp, source-hash format, current policy and exclusion reasons.
- Reconcile fetched, eligible and excluded counts with snapshot rows and declared
  daily registry counts. Enforce configured store and source-record bounds.
- Validate every roster row's safe identity and name; prohibit duplicate stores
  or places. The daily roster must equal the snapshot roster in identity, live
  name, optional reference area and order.
- Existing place/merchant aliases retain their store IDs and reference areas.
  Live names can change. An alias absent from the database snapshot is not
  enrolled. New places must use the specified SHA-256-derived ID, cannot collide
  with any reserved alias, and do not acquire an invented expected area.
- A snapshot's source response hash covers normalized database identities and
  exclusions. Eligible source-document IDs are not stored in that snapshot, so
  the original hash cannot be independently recomputed from it. Reports state
  this limitation; file-receipt verification is separate from raw DB truth.

The verifier expects a ready registry for release acceptance. If discovery itself
failed, stopped or returned no eligible stores, inspect the explicit registry
outcome and original exit rather than treating the helper's non-ready rejection
as a new collector outage. This copy is not a zero-store acceptance verifier.

## Preserved full-artifact checks

Every referenced registry/selection snapshot and daily/batch manifest is read,
followed by every batch artifact from every query attempt. Downloads are bounded
and resumable. Provenance-aware caches never let an offline replay establish a
fresh Azure-login verdict. Receipts verify exact bytes and SHA-256. JSON/CSV rows,
attempt ownership, fully visible listing observations and all PNG structures are
checked. Original static runs without `storeDiscovery` retain the historical
verification path.

`partial` plus `executionStatus=completed` and exit 0 is valid only for fully
evidenced recognized non-ranking details. Details are not ranking lists.
`nonRanking` remains a subset of `partial`. No-results pages are counted
separately. Geographic relevance remains unverified without a verified reference
area. Full hashes and PNG structure checks do not replace visual review.

Outputs are `readback-report.json`, `object-inventory.json`,
`query-inventory.json` and `visual-samples.json`. The readback report includes a
new `registry` summary and `scope.storeRegistrySnapshotAndIdentityChecks` flag.
Visually review samples for all actual stores and any partial reason after
structural verification. Report that visual sample scope separately.

Exit 0 means evidence consistency and complete execution; exit 2 means verified
but incomplete execution; exit 1 means the acceptance contract was rejected.
Always retain the original Pod exit separately.

## Offline validation

```sh
python3 -m unittest -v test_verify_daily.py test_registry_verify.py test_adapter_verify.py
```

The original 24 tests are unchanged. Thirteen additional registry tests cover
dynamic enrollment instead of aliases, live names, exact config dependency,
receipt corruption, missing/foreign snapshots, count/capacity reconciliation,
identity conflicts, legacy aliases, stable new-place IDs, reserved IDs and
reference areas, duplicate identities and unsupported policies/exclusions.
Five additional version tests cover complete v4 discovery acceptance, the CLI's
v4 default, rejection before reads for unsupported versions, and stale v3 batch
and result metadata with correctly resigned receipts. All 42 tests run offline.

See `validation.json` for the current test count, status, helper SHA-256 and
preservation checks. The copied `local-test-results.txt` is the earlier 37-test
v3 baseline. These tests make no network or cluster calls and are not a live-run
verification result.
