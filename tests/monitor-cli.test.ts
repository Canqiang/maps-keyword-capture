import { describe, expect, it } from 'vitest';
import { parseMonitorArgs, monitorBrowserEnv, createMonitorShutdown } from '../src/monitor/cli-options.js';
import { summarizeOwnStore } from '../src/monitor/identity.js';
import type { Listing } from '../src/contracts.js';

describe('strict monitor CLI', () => {
  it('accepts the deployment invocation and manual recovery key', () => expect(parseMonitorArgs(['--config', '/config/monitor.json', '--storage', 'azure', '--run-key', 'acceptance-1'])).toEqual({ configPath: '/config/monitor.json', storage: 'azure', runKey: 'acceptance-1' }));
  it.each([[], ['--config'], ['--config', 'a', '--config', 'b'], ['--config=a'], ['--config', 'a', '--wat', 'x'], ['--config', 'a', '--storage', 'azure', '--storage', 'azure'], ['--config', 'a', '--run-key', '../bad'], ['--config', 'a', '--storage', '--run-key'], ['--config', 'a', '--storage', 'typo'], ['--config', 'a', 'stray']])('rejects malformed input %j', args => expect(() => parseMonitorArgs(args)).toThrow());
  it('excludes discovery credentials, source token and storage settings from Chromium environment', () => expect(monitorBrowserEnv({ PATH: '/usr/bin', KEYWORD_API_TOKEN: 'token', AZURE_STORAGE_CONTAINER_SAS_URL: 'sas', KEYWORD_MONGO_URI: 'mongodb://reader:secret@db/seo-integration' })).toEqual({ PATH: '/usr/bin' }));
  it('first signal aborts; subsequent signals do not cut short finalization or extend grace', () => {
    const controller = new AbortController(); const scheduled: Array<{ fn: () => void; ms: number }> = []; let forced = false;
    const handle = createMonitorShutdown(controller, () => { forced = true; }, (fn, ms) => { scheduled.push({ fn, ms }); return (() => {}) as any; });
    handle('SIGTERM'); handle('SIGTERM');
    expect(controller.signal.aborted).toBe(true); expect(scheduled).toHaveLength(1); expect(scheduled[0]?.ms).toBe(300000);
    expect(forced).toBe(false); scheduled[0]!.fn(); expect(forced).toBe(true);
  });
});
describe('canonical own-store summaries', () => {
  const listing = { name: 'same name', placeId: '0x123:0x456', businessKey: '0x123:0x456', mapsUrl: null, displayPosition: 2, organicRank: 1, resultType: 'organic' } as Listing;
  it('does not guess by name or compare hex feature IDs to Place IDs', () => expect(summarizeOwnStore('ChIJone', [listing]).status).toBe('identity_unresolved'));
  it('matches canonical IDs and retains display/organic/ad positions separately', () => expect(summarizeOwnStore('ChIJone', [{ ...listing, placeId: 'ChIJone' }, { ...listing, placeId: 'ChIJone', resultType: 'ad', organicRank: null, displayPosition: 1, adLabel: 'Sponsored' }])).toMatchObject({ status: 'observed', displayPositions: [2, 1], organicRanks: [1], adDisplayPositions: [1] }));
  it('can use a canonical ID explicitly present in the raw Maps URL', () => expect(summarizeOwnStore('ChIJone', [{ ...listing, mapsUrl: 'https://www.google.com/maps/place/a/data=!1s0x123:0x456!19sChIJone' }]).status).toBe('observed'));
  it('reports absence only in resolved observed scope, never inventing rank16', () => expect(summarizeOwnStore('ChIJone', [{ ...listing, placeId: 'ChIJother' }])).toMatchObject({ status: 'not_observed', organicRanks: [], observedScope: 1 }));
});
