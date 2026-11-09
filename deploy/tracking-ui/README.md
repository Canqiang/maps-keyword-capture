# Tracking UI

`maps-tracking-ui` in `uat` is the front end of the rank-tracking system: a store list with ranking summaries, per-store latest ranks with change since the previous scan, a 14-day trend chart, the grid heat map with ARP, ATRP, SoLV and ring figures, the listing and screenshots behind each observation, and forms to add, edit and pause stores. It serves the page and a JSON API from one Node process (`dist/web/server.js`, same image as the scans) and reads screenshots from the private evidence container through a read-only proxy restricted to PNG keys.

## Open it

The authenticated UAT viewer is https://maps.connexup-uat.net (Application Gateway Ingress, manifest in `deploy/tracking-targets/ui.yaml`). The browser gets a sign-in page at `/login`; a successful login sets a signed `maps_session` cookie for 12 hours (`HttpOnly`, `SameSite=Lax`, `Secure` behind TLS). The cookie is signed with a per-process secret, so a redeploy or restart signs everyone out. Scripts can still send HTTP Basic credentials instead. Username and password come from the `maps-tracking-ui-auth` Secret (`TRACKING_AUTH_USER` / `TRACKING_AUTH_PASSWORD`); the page never embeds them. `POST /logout` clears the session.

Without the Ingress, port-forward still works:

```bash
kubectl -n uat port-forward svc/maps-tracking-ui 8080:80
# then open http://localhost:8080
```

## Collect now

The topbar button **立即采集** opens a panel listing the configured collection targets with their CronJob schedule, suspended state and recent Jobs, and starts a one-off Job from the CronJob's template (the same as `kubectl create job --from=cronjob/<name>`). Only one Job per target runs at a time (409 otherwise); the panel polls every 15 s while a Job is active. The CronJob, its ConfigMaps and Secrets are never modified.

Configuration: `TRACKING_SCAN_TARGETS` is a JSON array of `{ "id", "title", "cronJob", "description"? }`; the UI needs the `maps-tracking-ui` ServiceAccount with the Role in `deploy/tracking-targets/ui-rbac.yaml` (get/list CronJobs, get/list/create Jobs in `uat`). Without the variable the button is hidden and `/api/scans` answers 503; read-only previews never expose it. A manual Job can still collide with the scheduled slot of the same CronJob (both write the same collections); the panel shows the running Job so you can wait for it.

## Deploy

Deployed 2026-11-09 from commit `1b6766e` (ACR run `ch1663`) with digest `sha256:9a3bb9542ae9eac6811230fa8b507fe2e5d35a538db809e29566f56bf09e1cfc`: the timeline API now returns lean rows and the service gzips text responses, so the 14-day four-point keyword overview loads in about 5 s instead of a minute or more. The live Deployment mounts ConfigMap `maps-targets-liya90-v1-476d4c50`; do not `kubectl apply` the older manifest below without confirming its volume and image.

Deployed 2026-10-21 14:40 Asia/Shanghai from `deploy/tracking-targets/ui.yaml` + `ui-rbac.yaml` with image digest `sha256:0a9d412be44ccb8429b7410b69ffe6fb56270e3f7d91408925f0f22672c398e5`: sign-in page, session cookie, the collect-now button, and real OpenStreetMap base maps (Leaflet 1.9.4 from cdnjs) under the point and grid views with Local Falcon style rank pins, true 1 / 3 / 5 km distance rings and a legend; the former SVG sketches remain as the fallback when the library cannot load.

```bash
kubectl apply -f deploy/tracking-web/configmap.yaml -f deploy/tracking-ui/deployment.yaml
kubectl -n uat rollout status deploy/maps-tracking-ui
```

The image is pinned to the same digest as `deploy/tracking-web/cronjob.yaml`; `tests/tracking-web-deploy.test.ts` enforces that.

## Seed or bulk-import stores

```bash
kubectl -n uat port-forward svc/maps-tracking-ui 8080:80 &
python3 -c "import json;[print(json.dumps(s)) for s in json.load(open('deploy/tracking-web/stores-seed.json'))['stores']]" |
  while read -r store; do curl -s -X POST localhost:8080/api/stores -H 'content-type: application/json' -d "$store"; echo; done
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Shared settings (timezone, cadences, grid defaults) |
| GET / POST | `/api/stores` | List with summaries / create |
| GET / PUT | `/api/stores/:id` | Read / replace (storeId cannot change) |
| PUT | `/api/stores/:id/active` | `{ "active": false }` pauses tracking |
| GET | `/api/stores/:id/latest?surface=web&point=r0c0` | Latest rank per keyword with the previous one |
| GET | `/api/stores/:id/timeline?surface=web&point=…&from=YYYY-MM-DD&to=YYYY-MM-DD` | Paginated history rows for the overview and per-date matrix (lean projection; full record via `/observations/:id`) |
| GET | `/api/stores/:id/observations/:id?surface=web` | One observation with listings, quality detail and screenshot keys |
| GET | `/api/stores/:id/trend?surface=web&keyword=…&days=14` | Rank history |
| GET | `/api/stores/:id/grid?surface=web&keyword=…&date=YYYY-MM-DD` | Grid cells and metrics for one day |
| GET | `/api/evidence?key=…png` | Screenshot from the evidence container |
| GET | `/api/scans` | Collection targets (schedule, suspended, running) and their recent Jobs |
| POST | `/api/scans/:id/trigger` | Start a one-off Job from the target's CronJob template (202; 409 while one runs) |
| GET / POST | `/login`, `/logout` | Sign-in page and session handling (POST `/logout` clears the cookie) |
