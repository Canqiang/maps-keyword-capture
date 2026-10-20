# Tracking UI

`maps-tracking-ui` in `uat` is the front end of the rank-tracking system: a store list with ranking summaries, per-store latest ranks with change since the previous scan, a 14-day trend chart, the grid heat map with ARP, ATRP, SoLV and ring figures, the listing and screenshots behind each observation, and forms to add, edit and pause stores. It serves the page and a JSON API from one Node process (`dist/web/server.js`, same image as the scans) and reads screenshots from the private evidence container through a read-only proxy restricted to PNG keys.

## Open it

The Service is ClusterIP only; there is no Ingress and no login yet, so access is whoever can port-forward in `uat`:

```bash
kubectl -n uat port-forward svc/maps-tracking-ui 8080:80
# then open http://localhost:8080
```

Exposing it beyond port-forward needs an Ingress and an authentication decision (for example the cluster's existing SSO proxy); both are deliberately left out.

## Deploy

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
| GET | `/api/stores/:id/trend?surface=web&keyword=…&days=14` | Rank history |
| GET | `/api/stores/:id/grid?surface=web&keyword=…&date=YYYY-MM-DD` | Grid cells and metrics for one day |
| GET | `/api/evidence?key=…png` | Screenshot from the evidence container |
