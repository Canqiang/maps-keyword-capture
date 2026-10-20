# Daily scheduled batch

CronJob `maps-capture-daily` in `dev-ai` runs the production batch every day at 10:00 New York time. Each run delivers every artifact to the private container `maps-keyword-capture` in `fbrdevstorage` and verifies it by read-back, exactly like a manual Job. Its Pod is the one in [`deploy/job/job.yaml`](../job/job.yaml), and `npm test` fails if the two drift apart. It reads its keywords from its own ConfigMap, `maps-capture-keywords-daily`, so a manual batch never changes what the schedule collects.

Storage setup, the image build, and SAS revocation and rotation are in [`deploy/job/README.md`](../job/README.md). The CronJob uses the same Secret, `maps-keyword-capture-storage`, which must exist before the first run.

The blocks in this file are safe to paste into an interactive shell.

## Deploy or change

```bash
kubectl apply -f deploy/cronjob/configmap.yaml -f deploy/cronjob/cronjob.yaml
kubectl -n dev-ai get cronjob maps-capture-daily
```

- **Keywords.** Edit `configmap.yaml` (at most 20) and apply it. The next run reads the new list; a run in progress keeps the old one. An invalid list makes the next run exit 64 without collecting anything, so run `npm test` first: it validates the file.
- **Schedule.** Edit `schedule` and `timeZone` in `cronjob.yaml` and apply it. A 20-keyword run took about 6 minutes, and the Job deadline is 3000 s. `concurrencyPolicy: Forbid` makes a schedule wait while the previous scheduled run is still active; it does not see Jobs created by hand (see [Run now](#run-now-pause-stop-remove)). Before changing the time, run the check in [Co-tenants on the pool](#co-tenants-on-the-pool): the new window must not overlap another browser workload there.
- **Image.** Put a new digest into `image` and `IMAGE_DIGEST` in both `deploy/job/job.yaml` and `cronjob.yaml`, run `npm test`, then apply `cronjob.yaml`. The next run uses it.

## Check runs

```bash
kubectl -n dev-ai get cronjob maps-capture-daily
kubectl -n dev-ai get jobs -l app.kubernetes.io/instance=maps-capture-daily --sort-by=.metadata.creationTimestamp
JOB=$(kubectl -n dev-ai get jobs -l app.kubernetes.io/instance=maps-capture-daily --sort-by=.metadata.creationTimestamp -o name | tail -n 1)
kubectl -n dev-ai logs "$JOB" | tail -n 1
```

The last log line is normally the JSON summary. A Job marked `Complete` exited 0: every keyword was captured and every artifact verified. For a Job marked `Failed`, read the last line:

- JSON with `status: partial` and `remotePersistence: verified`: exit 2. Some keywords were partial, blocked, or skipped, but everything collected was delivered.
- JSON with `status: failed` or `remotePersistence: failed`: exit 1. Either nothing was collected (for example every keyword skipped because the browser or storage was unavailable; see `counts`), or something collected was not delivered.
- A line that is not JSON, such as `invalid configuration: ...`: the run exited before collecting (64 for a bad ConfigMap) or crashed.
- `kubectl logs` itself fails because the Pod is gone: the Job most likely hit its 3000 s deadline, which also counts time spent `Pending` on the fixed `aiapp` pool. `kubectl -n dev-ai describe "$JOB"` shows `DeadlineExceeded`. The Pod still received SIGTERM and normally published its manifest, so look for the run in Azure.

The last 7 successful and 7 failed Jobs are kept, older ones are deleted automatically, and a Job's log lasts as long as its Pod. A run stopped by its deadline or by deleting its Pod has no log left. Results in Azure are never deleted by the CronJob.

## Find results in Azure

Every run writes under `<date>/<runId>/<attemptId>/`. The date folder is the Asia/Shanghai date (the config's `filenameTimezone`) when the run started, and the run ID contains the UTC start time, such as `run_20260917T140005Z_…`. A run that starts on time at 10:00 New York time lands on the same date (22:00 or 23:00 in Shanghai). A late start, from 11:00 EST or 12:00 EDT onward, lands on the next date, so the block lists both.

```bash
# The New York date of the run; set DAY=YYYY-MM-DD for another day.
DAY=$(TZ=America/New_York date +%Y-%m-%d)
NEXT=$(python3 -c 'import datetime, sys; print(datetime.date.fromisoformat(sys.argv[1]) + datetime.timedelta(days=1))' "$DAY")
for P in "$DAY/" "$NEXT/"; do
  az storage blob list --account-name fbrdevstorage --container-name maps-keyword-capture --auth-mode login \
    --prefix "$P" --query "[?ends_with(name, '/manifest.json')].name" -o tsv
done
```

Each line is one run's final manifest. Download one run by pasting its line into `MANIFEST`:

```bash
MANIFEST='paste one line from the listing here'
PREFIX=${MANIFEST%manifest.json}
case "$PREFIX" in
  */run_*/att_*/)
    mkdir -p outputs/azure
    az storage blob download-batch --account-name fbrdevstorage --source maps-keyword-capture --auth-mode login --pattern "${PREFIX}*" --destination outputs/azure
    ;;
  *) echo "MANIFEST is not a manifest path from the listing; nothing was downloaded" >&2 ;;
esac
```

## Run now, pause, stop, remove

- **Run now.** `Forbid` only sees Jobs the CronJob scheduled itself: a Job created by hand, from this CronJob or from `deploy/job/`, neither waits for a scheduled run nor holds one back. Two runs at once share one egress IP and compete for CPU on the pool (see [Co-tenants on the pool](#co-tenants-on-the-pool)). Check that nothing is running, and do not start a manual run within an hour before 10:00 New York time unless the CronJob is suspended.

  ```bash
  kubectl -n dev-ai get jobs -l app.kubernetes.io/name=maps-keyword-capture
  ```

  Start only when no Job listed has STATUS `Running`:

  ```bash
  JOB=$(kubectl -n dev-ai create job --from=cronjob/maps-capture-daily "maps-capture-daily-manual-$(date -u +%Y%m%d%H%M)" -o name)
  kubectl -n dev-ai logs -f "$JOB"
  ```

- **Pause and resume.** Suspending does not stop a run in progress. Applying `cronjob.yaml` again does not change `suspend`. A run missed by less than an hour starts as soon as the CronJob is resumed.

  ```bash
  kubectl -n dev-ai patch cronjob maps-capture-daily --type=merge -p '{"spec":{"suspend":true}}'
  kubectl -n dev-ai patch cronjob maps-capture-daily --type=merge -p '{"spec":{"suspend":false}}'
  ```

- **Stop a run in progress.** Set `JOB` to the running Job with the `JOB=$(...)` line from [Check runs](#check-runs), then use the stop block in [`deploy/job/README.md`](../job/README.md#stop-revoke-rotate). Its final `kubectl delete "$JOB"` is optional here: the history limits remove the Job later.
- **Remove the schedule.** `kubectl -n dev-ai delete cronjob maps-capture-daily` also deletes the Jobs it created, their logs, and any run in progress, so check for a `Running` Job first. Results already in Azure stay. Delete the keywords with `kubectl -n dev-ai delete configmap maps-capture-keywords-daily`.

## Co-tenants on the pool

Every run shares the fixed `aiapp` pool and the cluster's egress IP with other workloads. Two browsers at once share one egress and compete for CPU, and on 2026-09-28 the pool had under 400m of unreserved CPU per node (see [`docs/uat-monitor-operations.md`](../../docs/uat-monitor-operations.md)). Run this check before moving the schedule and before starting a run by hand.

The known browser workload on the pool is the CronJob `maps-keyword-monitor-daily` in `uat` ([`deploy/uat-monitor/cronjob.yaml`](../uat-monitor/cronjob.yaml)); it uses the same egress profile. It is committed with `suspend: true` and is resumed after UAT acceptance without anyone reopening this file, so treat it as live. It starts at 00:00 Asia/Shanghai and its Job deadline is 51 000 s, so its window is 00:00 to about 14:10 Shanghai: 12:00 to 02:10 the next day in New York during EDT, or 11:00 to 01:10 during EST. The current 10:00 New York schedule (22:00 or 23:00 Shanghai, about 6 minutes plus up to the 3000 s deadline) is outside that window.

Compare windows, not start times: a workload's window is its schedule plus its Job deadline, or its measured duration when that is known. The two CronJobs declare different `timeZone` values, so convert with the TIMEZONE column before comparing the SCHEDULE columns. A CronJob listing is also not the whole picture: a Job started by hand from `deploy/job/`, `deploy/dev-trial/` or either CronJob, and any other Pod on the pool, never appears in it.

```bash
kubectl -n dev-ai get cronjobs -o wide
kubectl -n uat get cronjobs -o wide
kubectl -n dev-ai get jobs -l app.kubernetes.io/name=maps-keyword-capture
kubectl -n uat get jobs -l app.kubernetes.io/name=maps-keyword-monitor
```

With cluster-wide read access, this also lists every running Pod on the pool, whatever created it:

```bash
for NODE in $(kubectl get nodes -l envpool=aiapp -o jsonpath='{.items[*].metadata.name}'); do
  kubectl get pods -A --field-selector "spec.nodeName=$NODE,status.phase=Running" -o wide
done
```

## Limits

- The stored access policy behind the SAS expires on 2027-09-17. After that every run fails within seconds with `storage_unavailable` and exit 1. Extend the policy before then; see [`deploy/job/README.md`](../job/README.md#stop-revoke-rotate).
- Nothing alerts on a failed run. Check the Jobs above or the manifests in Azure.
- A CAPTCHA or consent page stops the rest of that day's batch (`batch_blocked`, exit 2). Daily runs from the same cluster egress had not been observed over several days when this schedule was deployed.
