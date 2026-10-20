#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { generateGrid, type GridSpec } from './grid.js';
import { computeGridMetrics, heatMapRows, observationsFromAndroidManifest, type AndroidManifestLike } from './metrics.js';

const USAGE = [
  'Usage:',
  '  grid points  --lat <deg> --lng <deg> --radius-km <km> --size <odd N> [--android-tasks --store-id <id> --store-name <name> --keyword <kw> [--alias <a>]... [--source <ref>]]',
  '  grid metrics --manifest <android manifest.json> --grid <points.json> --store-id <id> --keyword <kw> [--rank-field organicRank|displayPosition]',
].join('\n');

export function parseArgs(args: string[]): { command: string; options: Map<string, string[]> } {
  const command = args[0] ?? '';
  const options = new Map<string, string[]>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith('--')) throw new Error(`invalid option near ${flag}`);
    const value = args[i + 1];
    // A flag followed by another flag (or nothing) is a boolean switch such as --android-tasks.
    if (value === undefined || value.startsWith('--')) { options.set(flag, [...(options.get(flag) ?? []), '']); continue; }
    options.set(flag, [...(options.get(flag) ?? []), value]);
    i++;
  }
  return { command, options };
}
const one = (options: Map<string, string[]>, flag: string, fallback?: string): string => {
  const values = options.get(flag);
  if (!values) { if (fallback !== undefined) return fallback; throw new Error(`${flag} is required`); }
  if (values.length !== 1) throw new Error(`${flag} given more than once`);
  if (values[0] === '') throw new Error(`${flag} needs a value`);
  return values[0]!;
};
const num = (options: Map<string, string[]>, flag: string): number => {
  const value = Number(one(options, flag));
  if (!Number.isFinite(value)) throw new Error(`${flag} must be a number`);
  return value;
};

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { command, options } = parseArgs(args);
    if (command === 'points') {
      const spec: GridSpec = { center: { latitude: num(options, '--lat'), longitude: num(options, '--lng') }, radiusKm: num(options, '--radius-km'), size: num(options, '--size') };
      const points = generateGrid(spec);
      if (options.has('--android-tasks')) {
        const storeId = one(options, '--store-id'), storeName = one(options, '--store-name'), keyword = one(options, '--keyword');
        const aliases = options.get('--alias');
        const source = one(options, '--source', `grid ${spec.size}x${spec.size} radius ${spec.radiusKm} km around ${spec.center.latitude},${spec.center.longitude}`);
        const tasks = points.map(p => ({ storeId, storeName, keyword, ...(aliases ? { aliases } : {}),
          location: { id: p.id, label: `${p.id} (${p.distanceKm} km ${p.ring})`, latitude: p.latitude, longitude: p.longitude, accuracyMeters: 20, toleranceMeters: 100, source },
          sourceReference: source }));
        console.log(JSON.stringify({ grid: spec, tasks }, null, 2));
      } else console.log(JSON.stringify({ grid: spec, points }, null, 2));
      return 0;
    }
    if (command === 'metrics') {
      const manifest = JSON.parse(await readFile(one(options, '--manifest'), 'utf8')) as AndroidManifestLike;
      const gridFile = JSON.parse(await readFile(one(options, '--grid'), 'utf8')) as { grid: GridSpec };
      const grid = generateGrid(gridFile.grid);
      const rankField = one(options, '--rank-field', 'organicRank');
      if (rankField !== 'organicRank' && rankField !== 'displayPosition') throw new Error('--rank-field must be organicRank or displayPosition');
      const observations = observationsFromAndroidManifest(manifest, grid, { storeId: one(options, '--store-id'), keyword: one(options, '--keyword'), rankField });
      const metrics = computeGridMetrics(grid, observations);
      console.log(JSON.stringify({ storeId: one(options, '--store-id'), keyword: one(options, '--keyword'), rankField, metrics, heatMap: heatMapRows(grid, observations) }, null, 2));
      return 0;
    }
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 64;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
