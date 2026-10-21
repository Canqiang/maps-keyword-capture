# Live monitoring and retained history

The live UI reads the configured MongoDB tracking catalog and observations. Approved catalog stores show their exact `keywordTargets` and three explicit `fixedPoints`; archived keywords remain accessible through the historical-keyword switch. Fixed point IDs such as `keke-3km` are distinct from the old square-grid IDs such as `r+1c0`. A planned point with no observations remains selectable and shows no collection. Plan coordinates and the report's baseline values are labelled separately from recorded evidence.

Web and Android have separate history, status and screenshot selection. The UI does not start collection. The active catalog defines future scope; imported old observations do not become evidence that the current schedule ran.

## Authenticated fixed address

Set both `TRACKING_AUTH_USER` and `TRACKING_AUTH_PASSWORD` in the server environment through a Kubernetes Secret. The server checks Basic authentication before serving the UI, API, store mutations, unknown routes or private evidence. Only `GET /healthz` is exempt for health probes. Both variables absent retains the existing internal-only deployment behavior; setting only one or an empty value fails startup. Credential digests are compared with `timingSafeEqual`, and error responses and logs do not include credentials.

Basic authentication must be served behind the HTTPS ingress. Do not place credentials in a URL or checked-in manifest. The browser handles the login challenge and sends authentication for same-origin API/image reads. Rotate the Secret and roll the deployment to rotate credentials.

## Append historical observations

Use the audited source snapshot, including its original evidence receipt index. The importer validates it with the snapshot loader and preserves the raw observation payload, including extra historical Android metadata.

```bash
# Default: read-only database plan. No index creation or database writes.
node dist/web/history-import.js \
  --snapshot /work/history/new-snapshot-v3.json \
  --database maps-rank-tracking \
  --stores-collection monitor-target-stores-v1 \
  --mongo-uri-env MAPS_TRACKING_MONGO_URI

# Apply the reviewed plan, then independently read back all source identities.
node dist/web/history-import.js \
  --snapshot /work/history/new-snapshot-v3.json \
  --database maps-rank-tracking \
  --stores-collection monitor-target-stores-v1 \
  --mongo-uri-env MAPS_TRACKING_MONGO_URI \
  --apply
```

The nine-store deployment uses the separate `monitor-target-stores-v1` store catalog and shares the existing `observations` history collection. This preserves the old collector's strict-schema `stores` collection and schedule. `--stores-collection` defaults to `stores` for backward compatibility; use the explicit isolated collection above for this deployment.

The importer never replaces an existing store or observation. A missing historical store is added with its exact store/Place ID, center (including unknown/null), timestamps and keyword history, but paused. This retains the extra historical store without enrolling it in new collection. Run the approved catalog import separately to activate the nine intended stores; its Place ID join must retain these historical store IDs.

Existing observation IDs with matching source identity are preserved, including any richer remote metadata. A reused ID with a different identity or a Place ID assigned to another store ID stops before writes. Apply establishes the store collection's unique Place ID index before inserts; the default read-only plan creates no indexes. Insert operations use `$setOnInsert`; retries cannot replace old data. If a concurrent writer causes a conflict partway through import, the process fails and the operator must inspect the append state before retrying. Successful output records the snapshot SHA-256, insertion/preservation counts and a full source-identity readback.

Database import does not upload image bytes. `imageAvailabilityVerified: false` is deliberate: retain the snapshot and all receipt-indexed original PNGs, make each referenced key available in the private Azure evidence container, and verify bytes/SHA-256 independently. Some Android archive paths were local runtime paths. A database readback alone is insufficient acceptance for original-image access.

No expiry or deletion is introduced by this importer. Retention of MongoDB and Azure storage must also preserve the existing historical collections and blobs.
