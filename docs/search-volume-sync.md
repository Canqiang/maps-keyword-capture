# Search volume via core-ai MCP

## Scope and acceptance

The independent Maps weekly job queries the existing `dataforseo/kw_data_google_ads_search_volume` tool through the authenticated core-ai MCP hub. It reads active monitored stores and the union of configured target words, generated best variants and the retained daily keyword roster. It never changes shared SEO keywords, store configuration, scan points, rank observations, screenshot objects, collector images or schedules. UI deployment only enables a read-only join with the new collection.

A successful run means every selected store/word has a checked outcome, not that every word has a numeric estimate. `no_data`, numeric zero, and request/contract failure are distinct. Missing/nonnumeric responses never become zero. Three real NYC long-tail probes on November 12 returned no numeric values.

## Data contract

- Region mappings in `deploy/search-volume/regions.json` are explicit, validated against the provider location catalog. Existing city-wide report markets are retained (NYC, Mineola NY, East Rutherford NJ); this is not point-level or Maps App search demand. Existing report snapshots are not overwritten. SEE JOY's old Midtown entries remain historical snapshots; new synchronized values use the configured NYC market explicitly.
- Han-script queries use Google Ads `zh_CN`; other current queries use `en`. These are query-targeting languages. New stores need an explicit region mapping before synchronization; unknown regions are skipped and reported as a partial run without blocking other configured stores. Future languages require explicit support.
- Queries are deduplicated by normalized exact keyword, region code and language. Best variants are queried independently, not assigned the base term's volume. Batches contain at most 10 keywords; at most 60 batches per run.
- The MCP response must succeed and provide the expected region. The tool's monthly object is preserved including null months. `search_volume` is an upstream monthly average estimate; the newest returned monthly data period is stored separately from the time it was fetched. The MCP schema does not expose the search-partner network setting; network composition is therefore not asserted.
- Existing successful values survive failed or no-data refreshes only for the same keyword/region/language. Both the successful synchronization time and most recent attempted status/time are visible. Values older than nine days display a stale label.
- Latest store documents: `maps-rank-tracking.search-volume-current-v1`; per-run store snapshots: `search-volume-history-v1`; plan/response/outcome audit: `search-volume-runs-v1`; separate lease: `search-volume-lock-v1`. Existing collection names are not mutated. Histories preserve what was known at each sync, while monthly series represents upstream estimates.

## Operation

Weekly Monday 10:30 Asia/Shanghai. New CronJob `maps-search-volume-weekly`, `Forbid`, no Pod retry, bounded two-hour lease, 110-minute runtime limit (paid calls stop within 90 minutes, reserving time for persistence), seven-day terminal Job retention. No automatic paid request retry: a transport timeout may have charged the upstream request already. A stuck lease expires after the runtime deadline. Initial deployment is suspended until independent readback; the checked-in manifest now records the accepted enabled state. This is a Kubernetes task, independent of the operator's computer.

The `maps-search-volume-core-ai` Secret contains the authorized core-ai hub URL and bearer credential, supplied securely at deployment, never committed or logged. It is only mounted as environment references in the sync Pod, not the UI. Credential revocation requires rotation of that Secret; no upstream DataForSEO credentials are copied. HTTPS is required and redirects are refused.

UI requires `TRACKING_SEARCH_VOLUME=on`. It reads only the new current collection. An unavailable volume service does not fail store/rank APIs. The original report metadata remains in the monitoring details/settings; new UI cells show upstream source, region, language, data month and successful sync time. Source values can be absent even when ranking capture succeeds.

## Recovery / rollback

Pause only `maps-search-volume-weekly` to stop future volume requests. Disable UI volume join with `TRACKING_SEARCH_VOLUME=off` (or restore its previous pinned UI image). Keep all volume/history records, screenshots, rankings and shared SEO library. Do not rerun rank collectors to repair search-volume data. For partial sync, inspect sanitized run status and response contract before running an explicit recovery. `--retry-recent` reuses only matching successful/no-data outcomes less than 24 hours old, preserving their original timestamps and source run IDs; only errors/missing/changed-region-or-language values are requested again. Weekly jobs do not use this flag. The initial live test rejected `zh` (40501); a live `zh_CN` probe succeeded, and the corrected code uses `zh_CN`.

Recovery only reuses already-published current store snapshots. If a run failed after paid calls but before publishing store snapshots, inspect its saved raw responses before retrying; `--retry-recent` alone cannot prevent those requests from repeating. Synchronization timestamps are captured after the MCP response; completed runs also have a separate `finishedAt`.

## Connected MCP response cap

Live November 12 checks found that requests of 100/67/33 words returned only the first 10 items. The bridge schema exposes no return-limit override. Calls are therefore capped at 10 words and exact normalized requested/returned coverage is required before publishing. Only an explicit returned keyword with no metric counts as `no_data`; an omitted keyword is a response-contract failure. Rows carry `providerItemReturned=true`; recovery refuses pre-fix rows without this coverage proof. The first two trial runs are retained as superseded evidence, not accepted full-volume coverage.

## Related query variants

`keyword`, `keyword near me`, and `keyword + city` remain separate query records with their own market/language and provider receipts. This change does not add keywords or overwrite the base keyword's volume with a sum. A future topic-family aggregate would need explicit member queries and must not claim deduplicated people or Maps demand.

For repeated batch failures, an operator can explicitly use `--retry-recent --single-recovery`. Only unresolved queries are split into single-word requests; the 60-call budget applies after verified reuse. This is not enabled in the weekly CronJob and is not an automatic retry. A November 12 single-word probe succeeded after repeated batch failures.
