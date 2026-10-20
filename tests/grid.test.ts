import { describe, expect, it } from 'vitest';
import { generateGrid, haversineKm, pointId, pointSpacingKm, ringFor } from '../src/grid/grid.js';
import { computeGridMetrics, heatMapRows, observationsFromAndroidManifest, rankBucket, type GridObservation } from '../src/grid/metrics.js';
import { main, parseArgs } from '../src/grid/cli.js';

const keke = { latitude: 40.7658211, longitude: -73.8315243 };

describe('grid generation', () => {
  it('spaces a 7x7 grid evenly over a 5 km radius with the store at the centre', () => {
    const spec = { center: keke, radiusKm: 5, size: 7 };
    expect(pointSpacingKm(spec)).toBeCloseTo(1.6667, 3);
    const grid = generateGrid(spec);
    expect(grid).toHaveLength(49);
    expect(grid[0]).toMatchObject({ id: 'r+3c-3', row: 3, col: -3, ring: 'outer' });
    expect(grid[24]).toMatchObject({ id: 'r0c0', latitude: keke.latitude, longitude: keke.longitude, distanceKm: 0, ring: 'inner' });
    expect(grid[48]!.id).toBe('r-3c+3');
    // Edge points sit at the radius; corners at radius·√2.
    const east = grid.find(p => p.id === 'r0c+3')!, corner = grid.find(p => p.id === 'r-3c-3')!;
    expect(east.distanceKm).toBeCloseTo(5, 1);
    expect(corner.distanceKm).toBeCloseTo(5 * Math.SQRT2, 1);
    // Neighbouring points are one spacing apart in both axes.
    const centre = grid[24]!, north = grid.find(p => p.id === 'r+1c0')!, eastOne = grid.find(p => p.id === 'r0c+1')!;
    expect(haversineKm(centre, north)).toBeCloseTo(1.6667, 2);
    expect(haversineKm(centre, eastOne)).toBeCloseTo(1.6667, 2);
    expect(north.latitude).toBeGreaterThan(centre.latitude);
    expect(eastOne.longitude).toBeGreaterThan(centre.longitude);
  });
  it('assigns rings by distance and keeps ids stable', () => {
    const grid = generateGrid({ center: keke, radiusKm: 5, size: 5 });
    expect(grid.map(p => p.ring).filter(r => r === 'inner')).toHaveLength(1);
    expect(grid.find(p => p.id === 'r0c+1')!.ring).toBe('middle');
    expect(grid.find(p => p.id === 'r0c+2')!.ring).toBe('outer');
    expect(pointId(-3, 2)).toBe('r-3c+2');
    expect(ringFor(0.5)).toBe('inner');
    expect(ringFor(3)).toBe('middle');
    expect(ringFor(3.01)).toBe('outer');
    expect(ringFor(2, [0.5, 1.5])).toBe('outer');
  });
  it.each([
    [{ center: keke, radiusKm: 5, size: 4 }],
    [{ center: keke, radiusKm: 5, size: 17 }],
    [{ center: keke, radiusKm: 0, size: 5 }],
    [{ center: { latitude: 91, longitude: 0 }, radiusKm: 5, size: 5 }],
  ])('rejects invalid specs %#', spec => {
    expect(() => generateGrid(spec)).toThrow();
  });
});

describe('grid metrics', () => {
  const grid = generateGrid({ center: keke, radiusKm: 5, size: 3 });
  const obs = (ranks: Array<number | null>): GridObservation[] => grid.map((p, i) => ({ pointId: p.id, distanceKm: p.distanceKm, ring: p.ring, rank: ranks[i] ?? null }));
  it('computes ARP, ATRP, SoLV, buckets and rings like Local Falcon', () => {
    // Reading order: NW, N, NE, W, centre, E, SW, S, SE.
    const metrics = computeGridMetrics(grid, obs([null, 12, null, 3, 1, 2, null, 25, 8]));
    expect(metrics).toMatchObject({ points: 9, found: 5, arp: 5.2, solv: 0.333, notFoundRank: 21, missingPoints: [] });
    expect(metrics.atrp).toBeCloseTo((21 + 12 + 21 + 3 + 1 + 2 + 21 + 21 + 8) / 9, 2);
    expect(metrics.buckets).toEqual({ top3: 3, top10: 1, top20: 1, notFound: 4 });
    expect(metrics.rings.inner).toEqual({ points: 1, found: 1, arp: 1, atrp: 1, solv: 1 });
    expect(metrics.rings.outer.points).toBe(8);
    expect(metrics.rings.middle.points).toBe(0);
    expect(metrics.rings.middle.arp).toBeNull();
  });
  it('reports missing points instead of inventing ranks and rejects foreign or duplicate points', () => {
    const partial = obs([1, 2, 3]).slice(0, 3);
    const metrics = computeGridMetrics(grid, partial);
    expect(metrics.points).toBe(3);
    expect(metrics.missingPoints).toEqual(['r-1c-1', 'r-1c0', 'r-1c+1', 'r0c-1', 'r0c0', 'r0c+1'].sort((a, b) => grid.findIndex(p => p.id === a) - grid.findIndex(p => p.id === b)));
    expect(() => computeGridMetrics(grid, [...partial, { ...partial[0]! }])).toThrow(/duplicate/);
    expect(() => computeGridMetrics(grid, [{ pointId: 'r+9c0', distanceKm: 1, ring: 'inner', rank: 1 }])).toThrow(/outside/);
    expect(() => computeGridMetrics(grid, partial, { notFoundRank: 20 })).toThrow();
  });
  it('buckets ranks for the heat map and renders rows north to south', () => {
    expect(['top3', 'top10', 'top20', 'notFound', 'notFound'].map((b, i) => [b, rankBucket([3, 10, 20, 21, null][i]!)]).every(([a, b]) => a === b)).toBe(true);
    expect(heatMapRows(grid, obs([null, 12, null, 3, 1, 2, null, 25, 8]))).toEqual([' x 12  x ', ' 3  1  2 ', ' x  x  8 ']);
    expect(heatMapRows(grid, obs([1]).slice(0, 1))[2]).toBe(' ?  ?  ? ');
  });
  it('reads one store and keyword out of an Android manifest, skipping failed queries', () => {
    const manifest = { queries: [
      { storeId: 'keke', keyword: 'braised food', location: { id: 'r0c0' }, organicRank: 2, displayPosition: 3, listingStatus: 'partial', evidenceStatus: 'needs_review' },
      { storeId: 'keke', keyword: 'braised food', location: { id: 'r+1c0' }, organicRank: null, displayPosition: null, listingStatus: 'complete', evidenceStatus: 'captured' },
      { storeId: 'keke', keyword: 'braised food', location: { id: 'r-1c0' }, organicRank: null, displayPosition: null, listingStatus: 'not_evaluated', evidenceStatus: 'failed' },
      { storeId: 'keke', keyword: '卤味', location: { id: 'r0c0' }, organicRank: 9, displayPosition: 9, listingStatus: 'partial', evidenceStatus: 'needs_review' },
      { storeId: 'other', keyword: 'braised food', location: { id: 'r0c+1' }, organicRank: 1, displayPosition: 1, listingStatus: 'complete', evidenceStatus: 'captured' },
    ] };
    const observations = observationsFromAndroidManifest(manifest, grid, { storeId: 'keke', keyword: 'braised food' });
    expect(observations.map(o => [o.pointId, o.rank])).toEqual([['r0c0', 2], ['r+1c0', null]]);
    expect(observationsFromAndroidManifest(manifest, grid, { storeId: 'keke', keyword: 'braised food', rankField: 'displayPosition' })[0]!.rank).toBe(3);
    const metrics = computeGridMetrics(grid, observations);
    expect(metrics.missingPoints).toContain('r-1c0');
    expect(metrics.found).toBe(1);
  });
});

describe('grid cli', () => {
  it('parses repeated aliases and rejects dangling flags', () => {
    expect(parseArgs(['points', '--alias', 'a', '--alias', 'b']).options.get('--alias')).toEqual(['a', 'b']);
    expect(parseArgs(['points', '--android-tasks', '--size', '3']).options.has('--android-tasks')).toBe(true);
    expect(() => parseArgs(['points', 'stray'])).toThrow();
  });
  it('prints points or Android tasks and returns 64 on bad input', async () => {
    const logs: string[] = [];
    const original = console.log; console.log = (line: string) => { logs.push(line); };
    try {
      expect(await main(['points', '--lat', '40.7658211', '--lng', '-73.8315243', '--radius-km', '5', '--size', '3'])).toBe(0);
      expect(JSON.parse(logs[0]!).points).toHaveLength(9);
      expect(await main(['points', '--lat', '40.7658211', '--lng', '-73.8315243', '--radius-km', '5', '--size', '3', '--android-tasks', '--store-id', 'keke', '--store-name', 'Keke', '--keyword', 'braised food', '--alias', '可可小卤', '--alias', 'KEKE BRAISED DELI'])).toBe(0);
      const tasks = JSON.parse(logs[1]!).tasks;
      expect(tasks).toHaveLength(9);
      expect(tasks[4]).toMatchObject({ storeId: 'keke', keyword: 'braised food', aliases: ['可可小卤', 'KEKE BRAISED DELI'], location: { id: 'r0c0', latitude: 40.7658211 } });
      expect(await main(['points', '--lat', 'x'])).toBe(64);
    } finally { console.log = original; }
  });
});
