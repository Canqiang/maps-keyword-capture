# Unlocated monitoring every two hours — 2026-11-13

Status: deployed; two bounded manual probes and ingestion/API readback passed. The first new automatic slot is planned at18:00Asia/Shanghai and has not yet been observed in this acceptance.

Both existing primary and Keke-supplement CronJobs now run at00:00,02:00,...,22:00Asia/Shanghai. Ingestion runs at01:30,03:30,...,23:30. Stable Job-name claims replace date-only claims for future Jobs. Existing images,resources,ConfigMaps,words and query_only semantics are unchanged. Only the three specified CronJob fields changed; all other Cron specs/UIDs and the active located Web Job spec matched independent readback.

- Tests:2023passed across114files; typecheckpassed;38focusedtests passed after observed RED.
- Two manual probes:3existing Keke words each,originalexit0/restarts0. Six observations reconcile to selected Azure JSON identity/timestamps/rank/evidence. 30referenced objects were independently downloaded usingAzureCLIlogin and matched bytes/SHA256;two claims independently read.4PNGs passed structural validation; no visual or all-store accuracy claim.
- Ingestion:760queries read,6inserted,754existing,0errors,originalexit0. Three pre-existing target rows were independently re-read unchanged.
- Public HTTPS API returned both new observations for法拉盛 卤味外卖 at17:42:52and17:44:30Beijing, bothnaturalrank6,query_only; these are validation observations,not automated-schedule proof or SEO improvement.
- Latest full daily355queries took47m06s;22-word supplement2m46s. This is a previous low-frequency duration baseline,not proof of future12completedrounds/day.

Detailed evidence: /Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/unlocated-two-hour-2026-11-13

Limitations: unlocated geography remains unverified; the90-minute ingest offset can precede a slow110-minute collector,so latebatches wait until the nextpass. Forbid can skip/defer lateoverlap. Ingestion rereads today+yesterday and its eventual24-round load needs operational observation. Existing UI label日监控·未定位is retained; noUIredeployment or data migration was performed. NoGitcommit/push or changes to other projects.
