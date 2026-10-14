# Cohort capture verifier

Copied from the v6 limited-place-details verifier into a separate directory. `--cohort-smoke` skips only the historical requirement to observe at least one limited-actions detail; the default retains that requirement. All artifact hashes, bytes, runtime/config/profile, attempt ownership, JSON/CSV rows, observation coverage and PNG structure checks are unchanged. 112 offline tests passed.

Run `python3 -m unittest discover -s . -p 'test*.py'` from this directory. Historical fixture config is copied under `historical-fixtures/` so the v6 historical regression test retains its original expectations. The current three-query inputs are in the parent directory.

The durable probe log and downloaded readback tree remain in the local evidence directory documented by the parent README. Use `verify_smoke.py --cohort-smoke --log <probe.log> --out <readback> --digest <launch-plan digest> --source-commit <runtimeCommit> --expected-config ../smoke-config.json --expected-keywords ../smoke-keywords.json --workers 6`. Azure login is required for independent blob reads. Never use the Pod SAS for independent verification.
