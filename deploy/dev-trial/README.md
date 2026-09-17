# Dev trial run

A manual Job that runs the collector on the `aiapp` node pool in `dev-ai` with no Azure upload. Results stay on the Pod's `emptyDir`, and the container sleeps 15 minutes after the batch so they can be copied out. Use it to check the image in the cluster; it is not the production Job.

## Build the image

The image builds in ACR on amd64, so no local Docker is needed.

```bash
SHA=$(git rev-parse --short HEAD)
az acr build --registry FBRDevAcr --platform linux/amd64 \
  --image ai/maps-keyword-capture:$SHA --build-arg GIT_COMMIT=$SHA .
```

Put the printed digest into `job.yaml` in both `image` and `IMAGE_DIGEST`.

## Run

Edit the keywords in `configmap.yaml` first; the limit is 20 per batch.

```bash
kubectl apply -f deploy/dev-trial/configmap.yaml -f deploy/dev-trial/job.yaml
POD=$(kubectl -n dev-ai get pods -l job-name=maps-capture-dev-trial-1 -o jsonpath='{.items[0].metadata.name}')
kubectl -n dev-ai logs -f "$POD"          # wait for CAPTURE_EXIT=<code>
kubectl -n dev-ai top pod "$POD"          # optional, while it runs
```

## Copy the results and clean up

```bash
mkdir -p outputs/dev-trial
kubectl -n dev-ai cp "$POD":/work/outputs/maps-keyword-capture outputs/dev-trial/maps-keyword-capture
kubectl -n dev-ai delete job maps-capture-dev-trial-1
kubectl -n dev-ai delete configmap maps-capture-dev-trial-keywords
```

The Job name is fixed, so delete the previous Job before applying again. Copy within the 15-minute window; after that the Pod exits and its `emptyDir` is gone.
