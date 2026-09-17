import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, csvEscape, resultToCsv } from '../src/export/csv.js';
import type { KeywordResult, Listing, ScreenshotArtifact } from '../src/contracts.js';

function listing(over: Partial<Listing> & Pick<Listing, 'displayPosition' | 'name'>): Listing {
  return {
    resultType: 'organic', adLabel: null, organicRank: over.displayPosition,
    occurrenceId: `occ_${over.displayPosition}`, businessKey: null, address: null, mapsUrl: null, placeId: null,
    rating: null, reviewCount: null, category: null, rawText: '',
    classificationEvidence: { source: 'supported_layout', owner: null, labelText: null, layoutSignature: 'x', evaluatedLabelLocations: [], observationIds: [] },
    observationIds: [], screenshotIds: [],
    ...over,
  } as Listing;
}
const shot: ScreenshotArtifact = {
  id: 's1', filename: 'base__01.png', kind: 'results', bytes: 10, sha256: 'a', queryId: 'q0001', queryAttemptId: 'qa01',
  capturedAt: '2026-09-17T14:30:25.123+08:00', width: 1440, height: 1000, observationId: 'o1',
  storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null,
};
const result = {
  schemaVersion: '1', runId: 'run_1', attemptId: 'att_1', queryId: 'q0001', queryAttemptId: 'qa01', keyword: 'bubble tea, "garden" city',
  startedAt: '2026-09-17T14:30:00.000+08:00', finishedAt: '2026-09-17T14:30:25.123+08:00',
  status: 'captured', stopReason: 'limit_reached', error: null, requestedLimit: 15, observedCount: 2, sequenceVerified: true, finalUrl: null,
  metadata: { configHash: 'c', profileHash: 'p', adapterVersion: 'v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null },
  context: { locale: 'en-US', browserTimezoneId: 'America/New_York', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locationMode: 'query_only', configuredMapView: null, observedMapView: null, loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [] },
  quality: { verifiedPrefixLength: 2, classificationComplete: true, screenshotCoverageComplete: true, warnings: [], observedQueryText: null, queryCorrectionText: null },
  listings: [
    listing({ displayPosition: 1, name: '=Gong Cha', resultType: 'ad', adLabel: 'Sponsored', organicRank: null, rating: 3.9, reviewCount: 217, screenshotIds: ['s1'] }),
    listing({ displayPosition: 2, name: 'Boba "Baar"', organicRank: 1, address: '682 Stewart Ave, Garden City', screenshotIds: ['s1'] }),
  ],
  screenshots: [shot],
  observationArtifactIds: [],
} satisfies KeywordResult;

describe('csv', () => {
  it('escapes and guards values', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(4.8)).toBe('4.8');
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape('=SUM(1)')).toBe("'=SUM(1)");
    expect(csvEscape('-5 stars')).toBe("'-5 stars");
    expect(csvEscape('@handle')).toBe("'@handle");
  });

  it('writes a BOM, the header, and one row per listing', () => {
    const csv = resultToCsv(result);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(4); // header + 2 rows + trailing empty
    expect(lines[1]).toBe(`run_1,att_1,q0001,"bubble tea, ""garden"" city",2026-09-17T14:30:25.123+08:00,p,1,ad,,'=Gong Cha,,3.9,217,,,,Sponsored,base__01.png`);
    expect(lines[2]).toContain(',2,organic,1,"Boba ""Baar""","682 Stewart Ave, Garden City",');
  });

  it('writes only the header for an empty result', () => {
    const csv = resultToCsv({ ...result, listings: [], observedCount: 0 });
    expect(csv.slice(1)).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });
});
