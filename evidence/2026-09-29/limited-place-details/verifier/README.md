# Standalone v6 limited-details smoke verifier

`verify_smoke.py` independently reads one completed collector manifest and every referenced artifact. The live reader uses the current Azure CLI login and GET requests to the fixed UAT Blob container. It does not launch Google searches, change cluster resources, write cloud storage, or use SAS credentials. `--offline-root` explicitly reports `offline_replay`; an offline cache cannot satisfy Azure-login provenance.

The expected capture is the adjacent `smoke-config.json` / `normalized-smoke-config.json`, with these exact queries in order: `see joy`, `SEE JOY 喜聚`, `bubble tea mineola`, `Flushing`. `expected-keywords.json` is a local copy of that sequence. The verifier requires the full runtime source commit and immutable image digest supplied from release evidence, exact `maps-feed-card/v6`, the normalized capture config and profile hash, persisted request config, and result browser context. Geographic scope stays `query_only` with unverified geography.

## Acceptance and exit codes

- **0:** all selected queries are captured or complete recognized non-ranking details, execution is completed, and at least one **selected** detail-only result contains valid `limited_actions` evidence. A valid non-ranking observation retains `partial / non_ranking_result`, zero listings, header-only CSV, diagnostic PNG, JSON and observations evidence.
- **2:** evidence is internally consistent, but collection is incomplete or the selected limited-actions target was not observed. Historical optional `placeDetails` omission and standard details do not prove this regression.
- **1:** missing, corrupt or inconsistent evidence, incorrect provenance/config/profile, or invalid structured details.

`placeDetails` must have exactly `name`, `mapsUrl`, `recognition`, and `signals`. Limited recognition requires `visible_heading`, `named_pane`, `named_actions`, `save`, `send_to_phone`, `share`, and `website` or `phone`. Standard recognition requires `visible_heading` and `directions` or `address`. URLs must be trusted HTTPS Google place URLs and match the observed final URL. The actual page name is preserved; no merchant identity or rank is inferred from a redirect. A late feed-to-detail transition may retain a real ranked prefix and structured detail metadata, but remains incomplete and cannot satisfy the limited detail-only acceptance gate.

The manifest status, counts, selected-attempt policy and execution status are checked against underlying query evidence. Query artifact IDs preserve the union of all attempts. Every attempt's JSON/CSV, versions, ownership, observation references and screenshots are checked, including unsuccessful retries. Every artifact receipt is verified by byte count and SHA-256; PNG structure/CRC/decompression/dimensions and CSV schema/values are checked. A diagnostic PNG must actually be referenced in its result. Captured listings require accepted, fully visible screenshot observations.

## Run after an authorized smoke has finished

Fill `IMAGE_DIGEST`, `SOURCE_COMMIT` and `COLLECTOR_LOG` from the archived release/Job evidence. Execute from this directory:

```sh
python3 verify_smoke.py \
  --log "$COLLECTOR_LOG" \
  --out ../readback-v6 \
  --digest "$IMAGE_DIGEST" \
  --source-commit "$SOURCE_COMMIT" \
  --adapter-version maps-feed-card/v6 \
  --expected-config ../normalized-smoke-config.json \
  --expected-keywords expected-keywords.json
```

For a local artifact copy only, add `--offline-root /absolute/path/to/blob-root`. Offline replay is useful for regression and integrity checks; its report does not claim a fresh Azure read. Outputs include `readback-report.json`, `object-inventory.json`, `visual-review-plan.json`, and a provenance-bound cache ledger. Screenshot visual review and archived Kubernetes container termination/exit state remain separate evidence; the collector summary has no Pod exit code.

## Local verification and provenance

```sh
python3 -m unittest discover -v
python3 -m py_compile verify_smoke.py verification_helpers.py
```

`validation.json` records the fresh local run; `test-output.txt` retains full output and `test-summary.txt` gives compact counts. `retry-red-green.txt` demonstrates the retry regression fails under the old selected-only artifact rule and passes under the corrected all-attempt rule. Azure transport tests are mocked and perform no live request.

`baseline-provenance.json` pins the Sep 18 standalone verifier and Sep 28 registry-isolation verifier. Those historical files are unchanged. The copied `verification_helpers.py` differs from the reviewed Sep 28 helper only in its exact v6 adapter constant/error text. `verify_daily.py` is a compatibility import for inherited helper tests; this package's supported smoke entry point is `verify_smoke.py`. `helper-sha256.json` pins the local helper/test/document files.

Local test success is not live smoke acceptance, visual approval, CronJob promotion, full daily coverage, merchant identity verification, or a ranking improvement.
