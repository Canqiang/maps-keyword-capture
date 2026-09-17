# Local Collector Implementation Plan (Milestones 1 and 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic core and the local Google Maps collector so that `npm run capture -- --config examples/keywords.json` produces, per keyword, a result JSON, a CSV, an observations log, and screenshots under an attempt-isolated output tree, with a batch manifest, in local-only persistence mode.

**Architecture:** A sequential CLI drives one Chromium browser through Playwright. Per keyword it opens a query-only Maps search URL, reads the results feed DOM with an in-page script, classifies each feed child, reconciles overlapping observations by feed child index into a verified prefix, assigns display positions and organic ranks, and writes evidence and exports through an artifact store. Everything that does not touch the browser is a pure function with fixture tests; the browser layer is tested against a generated HTML fixture that imitates the feed, never against Google.

**Tech Stack:** Node 22+, TypeScript 7.0.2 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Playwright 1.63.0 with bundled Chromium (`channel: "chromium"`), zod 4 for runtime config validation, vitest 5 for tests, tsx for running TypeScript in development.

**Spec:** `docs/design.md` (sections 3 to 11), `docs/implementation-plan.md` (Milestones 1 and 2), `docs/superpowers/specs/2026-09-17-keyword-capture-design.md`, and the data contracts in `src/contracts.ts`. The contracts file is the source of truth for output shapes; this plan does not change it.

## Global Constraints

- Node `>=22`; TypeScript `7.0.2`; Playwright `1.63.0` pinned. Do not upgrade these.
- Every source file compiles under the existing `tsconfig.json` flags: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `module: NodeNext`. Relative imports use the `.js` suffix.
- English for code comments and documentation. Keyword text and page text are stored unmodified.
- Query-only search: build `https://www.google.com/maps/search/?api=1&query=<keyword>&hl=<locale language>` with `URL` and `URLSearchParams`. Never pass keyword text through a shell. Never add coordinates, a city, geolocation, or map panning. A supplied `mapView` is a configuration error.
- Defaults: 15 listings, 6 scrolls, 5 results screenshots, 90000 ms per keyword, viewport 1440x1000, locale `en-US`, browser timezone `America/New_York`, filename timezone `Asia/Shanghai`. Up to 20 keywords per batch.
- Browser launch: `chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true })`. Fresh context per query attempt, signed out, no geolocation permission.
- `displayPosition` counts ads; `organicRank` is null for ads and unknowns and for every listing after the first unknown. Ads and organic occurrences of one business are separate listings. Uncertainty fails closed: `unknown`, `unsupported_layout`, `sequence_ambiguous`, `unstable_results`.
- Output tree: `<outputDirectory>/maps-keyword-capture/<YYYY-MM-DD>/<runId>/<attemptId>/` with `request.json`, `manifest.progress.json`, `q0001/qa01/<files>`, `manifest.json`. Local mode reports `persistenceMode: "local_only"` and `persistenceStatus: "not_requested"`.
- Every emitted `Listing` must be fully visible in at least one saved results screenshot, or the result is not `captured`.
- Commit after every task with a conventional-commit message. Do not commit `outputs/`.

---

## File structure

```text
src/
  cli.ts                     Parse --config, run the batch, print a summary, set the exit code
  config.ts                  zod schema, ConfigError (exit 64), loadConfigFile()
  ids.ts                     sha256Hex, canonicalJson, hashJson, id generators
  naming.ts                  keywordSlug, filenameTimestamp, isoWithOffset, file names, output paths
  core/
    types.ts                 Internal types shared by core and browser: RawFeedChild, FeedSnapshot, FeedLayout, ClassifiedCard, ...
    feed-model.ts            classifyFeedChildren(): header / card / separator / trailer / unsupported, stride
    classify.ts              classifyCard(): ad / organic / unknown with evidence, place identity, rating, review count, category, address
    reconcile.ts             createReconcileState(), applyRound(): verified prefix across overlapping rounds
    ranking.ts               assignRanks(): displayPosition and organicRank; toListing()
    outcome.ts               deriveOutcome(): CollectionOutcome from stop cause and quality flags
  export/
    csv.ts                   csvEscape(), resultToCsv()
  storage/
    types.ts                 ArtifactStore interface, WrittenFile
    local.ts                 LocalArtifactStore: atomic writes, sha256, local_only persistence
  runner/
    manifest.ts              createManifest(), recordQueryAttempt(), markSkipped(), selectAttempt(), finalizeManifest(), exitCodeFor()
    query-runner.ts          runQueryAttempt(): one browser attempt for one keyword
    batch-runner.ts          runBatch(): sequential keywords, retry, circuit breaker, SIGTERM, manifests
  browser/
    launch.ts                launchBrowser(), newSearchContext()
    page-script.ts           readFeedSnapshotInPage(): the only code that runs inside the page
    maps-adapter.ts          buildSearchUrl(), openSearch(), detectPageState(), readSnapshot(), queryMatches(), nextScrollTop(), scrollFeedTo(), waitForFeedChange()
    stability.ts             snapshotSignature(), captureStableObservation()
tests/
  fixtures/feed-fixture.ts   buildFeedFixtureHtml(): generated Maps-like feed page for browser tests
  *.test.ts                  one test file per module
vitest.config.ts
tsconfig.build.json
```

---

### Task 1: Test and build tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `tsconfig.build.json`, `tests/smoke.test.ts`
- Modify: `tsconfig.json` (add `tests/**/*.ts` is NOT needed; vitest compiles tests itself)

**Interfaces:**
- Produces: `npm test` runs contract type tests then vitest; `npm run test:unit` runs vitest only; `npm run build` emits `dist/`; `npm run capture -- --config <path>` runs `src/cli.ts` via tsx.

- [ ] **Step 1: Install dev dependencies and zod**

```bash
cd /Users/xander/git_repo/maps-keyword-capture
npm install --save-exact zod@4.6.5
npm install --save-dev --save-exact vitest@5.0.1 tsx@4.23.13 @types/node@22
```

- [ ] **Step 2: Add scripts and config files**

Replace the `scripts` block in `package.json` with:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test:contracts": "tsc -p tsconfig.contract-tests.json --noEmit",
  "test:unit": "vitest run",
  "test": "npm run test:contracts && npm run test:unit",
  "build": "tsc -p tsconfig.build.json",
  "capture": "tsx src/cli.ts"
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run the checks**

Run: `npm test`
Expected: contract typecheck passes, vitest reports 1 passed.

Run: `npm run build && ls dist/contracts.js`
Expected: `dist/contracts.js` exists (an empty module is fine). Then `rm -rf dist`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.build.json tests/smoke.test.ts
git commit -m "chore: add vitest, tsx, zod, and build config"
```

---

### Task 2: Hashing and identifiers

**Files:**
- Create: `src/ids.ts`, `tests/ids.test.ts`

**Interfaces:**
- Produces:
  - `sha256Hex(data: Buffer | string): string`
  - `canonicalJson(value: unknown): string` (object keys sorted recursively, arrays kept in order)
  - `hashJson(value: unknown): string`
  - `newRunId(now?: Date): string` like `run_20260917T063025Z_a1b2c3`
  - `newAttemptId(): string` like `att_1f2e3d4c`
  - `queryIdFor(inputIndex: number): string` where inputIndex is zero-based, output `q0001`
  - `queryAttemptIdFor(attemptNumber: number): string` where attemptNumber is one-based, output `qa01`
  - `observationIdFor(queryAttemptId: string, n: number): string` output `qa01_obs003`
  - `occurrenceIdFor(parts: { placeKey: string; isAd: boolean; feedChildIndex: number }): string` output `occ_<16 hex>`

- [ ] **Step 1: Write the failing tests**

`tests/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  canonicalJson, hashJson, newAttemptId, newRunId, observationIdFor,
  occurrenceIdFor, queryAttemptIdFor, queryIdFor, sha256Hex,
} from '../src/ids.js';

describe('ids', () => {
  it('hashes strings and buffers identically', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
  });

  it('canonicalizes object key order but not array order', () => {
    expect(canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }] })).toBe('{"a":[3,{"y":2,"z":1}],"b":1}');
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });

  it('formats ids', () => {
    expect(newRunId(new Date('2026-09-17T06:30:25.123Z'))).toMatch(/^run_20260917T063025Z_[0-9a-f]{6}$/);
    expect(newAttemptId()).toMatch(/^att_[0-9a-f]{8}$/);
    expect(queryIdFor(0)).toBe('q0001');
    expect(queryIdFor(19)).toBe('q0020');
    expect(queryAttemptIdFor(1)).toBe('qa01');
    expect(observationIdFor('qa01', 3)).toBe('qa01_obs003');
  });

  it('separates ad and organic occurrences of one place', () => {
    const a = occurrenceIdFor({ placeKey: '0x1:0x2', isAd: true, feedChildIndex: 2 });
    const b = occurrenceIdFor({ placeKey: '0x1:0x2', isAd: false, feedChildIndex: 22 });
    expect(a).toMatch(/^occ_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(occurrenceIdFor({ placeKey: '0x1:0x2', isAd: true, feedChildIndex: 2 })).toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ids.test.ts`
Expected: FAIL, cannot find module `../src/ids.js`.

- [ ] **Step 3: Implement**

`src/ids.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function compactUtc(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function newRunId(now: Date = new Date()): string {
  return `run_${compactUtc(now)}_${randomBytes(3).toString('hex')}`;
}

export function newAttemptId(): string {
  return `att_${randomBytes(4).toString('hex')}`;
}

export function queryIdFor(inputIndex: number): string {
  return `q${String(inputIndex + 1).padStart(4, '0')}`;
}

export function queryAttemptIdFor(attemptNumber: number): string {
  return `qa${String(attemptNumber).padStart(2, '0')}`;
}

export function observationIdFor(queryAttemptId: string, n: number): string {
  return `${queryAttemptId}_obs${String(n).padStart(3, '0')}`;
}

export function occurrenceIdFor(parts: { placeKey: string; isAd: boolean; feedChildIndex: number }): string {
  const digest = sha256Hex(`${parts.placeKey}|${parts.isAd ? 'ad' : 'organic'}|${parts.feedChildIndex}`);
  return `occ_${digest.slice(0, 16)}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ids.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ids.ts tests/ids.test.ts
git commit -m "feat: add hashing and identifier helpers"
```

---

### Task 3: File naming and timestamps

**Files:**
- Create: `src/naming.ts`, `tests/naming.test.ts`

**Interfaces:**
- Produces:
  - `keywordSlug(keyword: string, maxLength?: number): string`
  - `filenameTimestamp(date: Date, timeZone: string): string` output `20260917T143025.123+0800`
  - `isoWithOffset(date: Date, timeZone: string): string` output `2026-09-17T14:30:25.123+08:00`
  - `dateFolder(date: Date, timeZone: string): string` output `2026-09-17`
  - `resultBaseName(date: Date, timeZone: string, keyword: string, queryId: string): string` output `20260917T143025.123+0800__bubble-tea-garden-city__q0001`
  - `screenshotFileName(baseName: string, n: number): string` output `<base>__01.png`
  - `attemptRelativeDir(date: Date, timeZone: string, runId: string, attemptId: string): string` output `maps-keyword-capture/2026-09-17/<runId>/<attemptId>`
  - `queryAttemptRelativeDir(queryId: string, queryAttemptId: string): string` output `q0001/qa01`

- [ ] **Step 1: Write the failing tests**

`tests/naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  attemptRelativeDir, dateFolder, filenameTimestamp, isoWithOffset, keywordSlug,
  queryAttemptRelativeDir, resultBaseName, screenshotFileName,
} from '../src/naming.js';

const at = new Date('2026-09-17T06:30:25.123Z');

describe('naming', () => {
  it('slugs keywords', () => {
    expect(keywordSlug('Bubble Tea  Garden City')).toBe('bubble-tea-garden-city');
    expect(keywordSlug('  fried chicken / mineola!  ')).toBe('fried-chicken-mineola');
    expect(keywordSlug('ｍａｔｃｈａ ｍｉｎｅｏｌａ')).toBe('matcha-mineola');
    expect(keywordSlug('奶茶 garden city')).toBe('garden-city');
    expect(keywordSlug('奶茶')).toBe('keyword');
    expect(keywordSlug('a'.repeat(100))).toHaveLength(60);
    expect(keywordSlug('x'.repeat(59) + ' yz')).toBe('x'.repeat(59));
  });

  it('formats timestamps in the configured timezone with offset', () => {
    expect(filenameTimestamp(at, 'Asia/Shanghai')).toBe('20260917T143025.123+0800');
    expect(filenameTimestamp(at, 'America/New_York')).toBe('20260917T023025.123-0400');
    expect(isoWithOffset(at, 'Asia/Shanghai')).toBe('2026-09-17T14:30:25.123+08:00');
    expect(dateFolder(at, 'Asia/Shanghai')).toBe('2026-09-17');
    expect(dateFolder(new Date('2026-09-17T17:30:00Z'), 'Asia/Shanghai')).toBe('2026-09-18');
  });

  it('builds file and directory names', () => {
    const base = resultBaseName(at, 'Asia/Shanghai', 'bubble tea garden city', 'q0001');
    expect(base).toBe('20260917T143025.123+0800__bubble-tea-garden-city__q0001');
    expect(screenshotFileName(base, 1)).toBe(`${base}__01.png`);
    expect(attemptRelativeDir(at, 'Asia/Shanghai', 'run_x', 'att_y')).toBe('maps-keyword-capture/2026-09-17/run_x/att_y');
    expect(queryAttemptRelativeDir('q0001', 'qa01')).toBe('q0001/qa01');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/naming.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/naming.ts`:

```ts
export function keywordSlug(keyword: string, maxLength = 60): string {
  const normalized = keyword.normalize('NFKC').toLowerCase();
  let slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'keyword';
}

interface Parts { year: string; month: string; day: string; hour: string; minute: string; second: string; offset: string }

function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  const raw = map['timeZoneName'] ?? 'GMT';
  const match = /GMT([+-]\d{2}):(\d{2})/.exec(raw);
  const offset = match ? `${match[1]}:${match[2]}` : '+00:00';
  return {
    year: map['year'] ?? '0000', month: map['month'] ?? '00', day: map['day'] ?? '00',
    hour: map['hour'] ?? '00', minute: map['minute'] ?? '00', second: map['second'] ?? '00',
    offset,
  };
}

function millis(date: Date): string {
  return String(date.getUTCMilliseconds()).padStart(3, '0');
}

export function filenameTimestamp(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}.${millis(date)}${p.offset.replace(':', '')}`;
}

export function isoWithOffset(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${millis(date)}${p.offset}`;
}

export function dateFolder(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function resultBaseName(date: Date, timeZone: string, keyword: string, queryId: string): string {
  return `${filenameTimestamp(date, timeZone)}__${keywordSlug(keyword)}__${queryId}`;
}

export function screenshotFileName(baseName: string, n: number): string {
  return `${baseName}__${String(n).padStart(2, '0')}.png`;
}

export function attemptRelativeDir(date: Date, timeZone: string, runId: string, attemptId: string): string {
  return `maps-keyword-capture/${dateFolder(date, timeZone)}/${runId}/${attemptId}`;
}

export function queryAttemptRelativeDir(queryId: string, queryAttemptId: string): string {
  return `${queryId}/${queryAttemptId}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/naming.test.ts`
Expected: 3 passed. If the `longOffset` assertion fails on this Node version, print `new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',timeZoneName:'longOffset'}).format(new Date())` and adjust the regex to the actual string form; do not change the expected outputs.

- [ ] **Step 5: Commit**

```bash
git add src/naming.ts tests/naming.test.ts
git commit -m "feat: add filename, timestamp, and output path helpers"
```

---

### Task 4: Configuration loading and validation

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`
- Read: `examples/keywords.json`, `src/contracts.ts` (`CaptureConfig`)

**Interfaces:**
- Produces:
  - `class ConfigError extends Error { readonly exitCode: 64 }`
  - `interface LoadedConfig { config: CaptureConfig; duplicateKeywordCount: number }`
  - `parseConfig(raw: unknown): LoadedConfig` throws `ConfigError`
  - `loadConfigFile(path: string): Promise<LoadedConfig>` throws `ConfigError` for unreadable or invalid JSON

- [ ] **Step 1: Write the failing tests**

`tests/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFile, parseConfig } from '../src/config.js';

const valid = {
  schemaVersion: '1',
  keywords: ['bubble tea garden city', 'matcha mineola'],
  maxResultsPerKeyword: 15,
  maxScrollsPerKeyword: 6,
  maxScreenshotsPerKeyword: 5,
  keywordTimeoutMs: 90000,
  locale: 'en-US',
  browserTimezoneId: 'America/New_York',
  filenameTimezone: 'Asia/Shanghai',
  viewport: { width: 1440, height: 1000 },
  outputDirectory: './outputs',
};

describe('config', () => {
  it('parses the example file', async () => {
    const loaded = await loadConfigFile('examples/keywords.json');
    expect(loaded.config.maxResultsPerKeyword).toBe(15);
    expect(loaded.config.keywords.length).toBeGreaterThan(0);
    expect(loaded.duplicateKeywordCount).toBe(0);
  });

  it('applies defaults for omitted limits', () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a'], outputDirectory: './out' });
    expect(config.maxResultsPerKeyword).toBe(15);
    expect(config.maxScrollsPerKeyword).toBe(6);
    expect(config.maxScreenshotsPerKeyword).toBe(5);
    expect(config.keywordTimeoutMs).toBe(90000);
    expect(config.viewport).toEqual({ width: 1440, height: 1000 });
    expect('mapView' in config).toBe(false);
  });

  it('rejects the reserved mapView field with a clear message', () => {
    expect(() => parseConfig({ ...valid, mapView: { latitude: 1, longitude: 2, zoom: 3 } }))
      .toThrowError(/mapView/);
  });

  it('rejects unknown fields, empty keywords, and invalid timezones', () => {
    expect(() => parseConfig({ ...valid, typo: 1 })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: [] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: ['  '] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, filenameTimezone: 'Mars/Olympus' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })).toThrow(ConfigError);
  });

  it('keeps duplicate keywords and counts them', () => {
    const loaded = parseConfig({ ...valid, keywords: ['a', 'a', 'b'] });
    expect(loaded.config.keywords).toEqual(['a', 'a', 'b']);
    expect(loaded.duplicateKeywordCount).toBe(1);
  });

  it('reports unreadable files as ConfigError', async () => {
    await expect(loadConfigFile('does-not-exist.json')).rejects.toThrow(ConfigError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/config.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CaptureConfig } from './contracts.js';

export class ConfigError extends Error {
  readonly exitCode = 64 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: CaptureConfig;
  duplicateKeywordCount: number;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timeZone = z.string().min(1).refine(isValidTimeZone, { message: 'must be a valid IANA time zone' });

const schema = z.object({
  schemaVersion: z.literal('1'),
  keywords: z.array(z.string().refine((k) => k.trim().length > 0, { message: 'keyword must not be blank' })).min(1).max(20),
  maxResultsPerKeyword: z.number().int().min(1).max(60).default(15),
  maxScrollsPerKeyword: z.number().int().min(0).max(50).default(6),
  maxScreenshotsPerKeyword: z.number().int().min(1).max(30).default(5),
  keywordTimeoutMs: z.number().int().min(5_000).max(600_000).default(90_000),
  locale: z.string().min(2).default('en-US'),
  browserTimezoneId: timeZone.default('America/New_York'),
  filenameTimezone: timeZone.default('Asia/Shanghai'),
  viewport: z.object({
    width: z.number().int().min(800).max(3840),
    height: z.number().int().min(600).max(2160),
  }).strict().default({ width: 1440, height: 1000 }),
  outputDirectory: z.string().min(1).default('./outputs'),
}).strict();

export function parseConfig(raw: unknown): LoadedConfig {
  if (raw !== null && typeof raw === 'object' && 'mapView' in raw) {
    throw new ConfigError('mapView is reserved for a future area-search mode and is not supported in this version; remove it to use query-only search');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    throw new ConfigError(`invalid configuration: ${detail}`);
  }
  const d = parsed.data;
  const config: CaptureConfig = {
    schemaVersion: d.schemaVersion,
    keywords: d.keywords,
    maxResultsPerKeyword: d.maxResultsPerKeyword,
    maxScrollsPerKeyword: d.maxScrollsPerKeyword,
    maxScreenshotsPerKeyword: d.maxScreenshotsPerKeyword,
    keywordTimeoutMs: d.keywordTimeoutMs,
    locale: d.locale,
    browserTimezoneId: d.browserTimezoneId,
    filenameTimezone: d.filenameTimezone,
    viewport: d.viewport,
    outputDirectory: d.outputDirectory,
  };
  const seen = new Set<string>();
  let duplicateKeywordCount = 0;
  for (const k of config.keywords) {
    if (seen.has(k)) duplicateKeywordCount += 1;
    seen.add(k);
  }
  return { config, duplicateKeywordCount };
}

export async function loadConfigFile(path: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config file ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/config.test.ts && npm run typecheck`
Expected: 6 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: validate capture configuration at runtime"
```

---

### Task 5: Internal types and feed child classification

**Files:**
- Create: `src/core/types.ts`, `src/core/feed-model.ts`, `tests/feed-model.test.ts`

**Interfaces:**
- Produces (in `src/core/types.ts`, used by every later task):

```ts
import type { BoundingBox, ObservedCard } from '../contracts.js';

export interface RawSponsoredLabel { text: string; ownerAriaLabel: string | null; depth: number }

/** One direct child of div[role="feed"], as read inside the page. */
export interface RawFeedChild {
  index: number;
  tag: string;
  heightPx: number;
  bounds: BoundingBox;            // viewport coordinates
  placeHref: string | null;       // first a[href*="/maps/place/"]
  placeAriaLabel: string | null;  // its aria-label (business name)
  ratingAriaLabel: string | null; // e.g. "4.8 stars"
  text: string;                   // innerText, whitespace collapsed
  sponsoredLabels: RawSponsoredLabel[];
}

export interface FeedSnapshot {
  children: RawFeedChild[];
  paneBounds: BoundingBox;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  endOfList: boolean;
  observedQueryText: string | null;
  pageTitle: string;
  url: string;
}

export type FeedChildKind = 'header' | 'card' | 'separator' | 'trailer' | 'unsupported';

export interface FeedLayout {
  firstCardIndex: number;
  stride: number;
  kinds: Map<number, FeedChildKind>;
  cards: RawFeedChild[];
}

export type FeedLayoutResult =
  | { ok: true; layout: FeedLayout }
  | { ok: false; reason: 'no_cards' | 'unsupported_layout'; detail: string };

export interface ParsedCardFields {
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  address: string | null;
}

/** ObservedCard plus the parsed listing fields the export needs. */
export type ClassifiedCard = ObservedCard & { parsed: ParsedCardFields };
```

- Produces (in `src/core/feed-model.ts`): `classifyFeedChildren(children: RawFeedChild[]): FeedLayoutResult`

Rules: a child with both `placeHref` and `placeAriaLabel` is a `card`. Children before the first card are `header` only if they have no `placeHref`. Between the first and last card, a non-card child is a `separator` when `heightPx <= 2` and `text` is empty; anything else there is `unsupported`. Children after the last card are `trailer`, except a child with `heightPx <= 2` and empty text directly following a card, which is a `separator`. The stride is the difference between consecutive card indices and must be constant; with a single card it is 2 when the next child is a separator, otherwise 1. Any `unsupported` child or irregular stride returns `{ ok: false, reason: 'unsupported_layout' }`. No cards returns `{ ok: false, reason: 'no_cards' }`.

- [ ] **Step 1: Write the failing tests**

`tests/feed-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import type { RawFeedChild } from '../src/core/types.js';

function child(index: number, over: Partial<RawFeedChild> = {}): RawFeedChild {
  return {
    index, tag: 'DIV', heightPx: 210,
    bounds: { x: 72, y: 80 + index * 100, width: 408, height: 210 },
    placeHref: null, placeAriaLabel: null, ratingAriaLabel: null, text: '', sponsoredLabels: [],
    ...over,
  };
}
function card(index: number, name: string, extra: Partial<RawFeedChild> = {}): RawFeedChild {
  return child(index, {
    placeHref: `https://www.google.com/maps/place/${encodeURIComponent(name)}/data=!4m7!3m6!1s0x89c2:0x${index}`,
    placeAriaLabel: name, ratingAriaLabel: '4.8 stars', text: `${name} 4.8 (100) Cafe · 1 Main St Closed`, ...extra,
  });
}
function separator(index: number): RawFeedChild { return child(index, { heightPx: 1, text: '' }); }

const observed: RawFeedChild[] = [
  child(0, { heightPx: 0, text: 'Rating Hours All filters' }),
  child(1, { heightPx: 48, text: 'Results Share' }),
  card(2, 'Gong Cha'), separator(3), card(4, 'Kyuramen'), separator(5), card(6, 'Boba Baar'),
  child(7, { heightPx: 120, text: '' }),
  child(8, { heightPx: 104, text: "You're seeing a limited view of Google Maps. Learn more" }),
];

describe('classifyFeedChildren', () => {
  it('recognizes the observed header / card / separator / trailer structure', () => {
    const r = classifyFeedChildren(observed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layout.firstCardIndex).toBe(2);
    expect(r.layout.stride).toBe(2);
    expect(r.layout.cards.map((c) => c.index)).toEqual([2, 4, 6]);
    expect(r.layout.kinds.get(0)).toBe('header');
    expect(r.layout.kinds.get(3)).toBe('separator');
    expect(r.layout.kinds.get(7)).toBe('trailer');
    expect(r.layout.kinds.get(8)).toBe('trailer');
  });

  it('fails closed on a text block between cards', () => {
    const withBanner = [...observed];
    withBanner[3] = child(3, { heightPx: 90, text: 'Ad · Sponsored results' });
    const r = classifyFeedChildren(withBanner);
    expect(r).toEqual({ ok: false, reason: 'unsupported_layout', detail: expect.stringContaining('index 3') });
  });

  it('fails closed on an irregular stride', () => {
    const r = classifyFeedChildren([card(2, 'A'), separator(3), card(4, 'B'), separator(5), separator(6), card(7, 'C')]);
    expect(r.ok).toBe(false);
  });

  it('reports no cards', () => {
    expect(classifyFeedChildren([child(0), child(1)])).toEqual({ ok: false, reason: 'no_cards', detail: expect.any(String) });
  });

  it('infers stride for a single card', () => {
    const r = classifyFeedChildren([card(2, 'A'), separator(3), child(4, { heightPx: 120 })]);
    expect(r.ok && r.layout.stride).toBe(2);
    const r1 = classifyFeedChildren([card(0, 'A')]);
    expect(r1.ok && r1.layout.stride).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/feed-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/core/types.ts` with exactly the interfaces in the **Interfaces** block above.

`src/core/feed-model.ts`:

```ts
import type { FeedChildKind, FeedLayout, FeedLayoutResult, RawFeedChild } from './types.js';

export function isCard(child: RawFeedChild): boolean {
  return child.placeHref !== null && child.placeAriaLabel !== null && child.placeAriaLabel.trim().length > 0;
}

export function classifyFeedChildren(children: RawFeedChild[]): FeedLayoutResult {
  const cards = children.filter(isCard);
  const first = cards[0];
  const last = cards[cards.length - 1];
  if (!first || !last) return { ok: false, reason: 'no_cards', detail: `no business cards among ${children.length} feed children` };

  const kinds = new Map<number, FeedChildKind>();
  for (const c of children) {
    if (isCard(c)) { kinds.set(c.index, 'card'); continue; }
    if (c.index < first.index) {
      kinds.set(c.index, c.placeHref === null ? 'header' : 'unsupported');
    } else if (c.index > last.index) {
      kinds.set(c.index, c.heightPx <= 2 && c.text.trim() === '' && c.index === last.index + 1 ? 'separator' : 'trailer');
    } else {
      kinds.set(c.index, c.heightPx <= 2 && c.text.trim() === '' ? 'separator' : 'unsupported');
    }
  }
  const unsupported = [...kinds.entries()].filter(([, k]) => k === 'unsupported').map(([i]) => i);
  if (unsupported.length > 0) {
    return { ok: false, reason: 'unsupported_layout', detail: `unrecognized feed child at index ${unsupported.join(', index ')}` };
  }

  let stride: number;
  if (cards.length >= 2) {
    const diffs = new Set<number>();
    for (let i = 1; i < cards.length; i++) diffs.add(cards[i]!.index - cards[i - 1]!.index);
    if (diffs.size !== 1) return { ok: false, reason: 'unsupported_layout', detail: `irregular card stride: ${[...diffs].join(',')}` };
    stride = [...diffs][0]!;
  } else {
    stride = kinds.get(first.index + 1) === 'separator' ? 2 : 1;
  }
  const layout: FeedLayout = { firstCardIndex: first.index, stride, kinds, cards };
  return { ok: true, layout };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/feed-model.test.ts && npm run typecheck`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/feed-model.ts tests/feed-model.test.ts
git commit -m "feat: classify feed children and infer card stride"
```

---

### Task 6: Card classification and field parsing

**Files:**
- Create: `src/core/classify.ts`, `tests/classify.test.ts`

**Interfaces:**
- Consumes: `RawFeedChild`, `ClassifiedCard`, `ParsedCardFields` from `src/core/types.ts`; `occurrenceIdFor`, `sha256Hex` from `src/ids.ts`; `ObservedCard`, `ClassificationEvidence`, `ListingClassification`, `BoundingBox` from `src/contracts.ts`.
- Produces:
  - `parsePlaceIdentity(href: string): { placeId: string | null; placeKey: string }` where `placeId` is the `!1s0x…:0x…` segment, else the `!19sChIJ…` segment, else null; `placeKey` is `placeId` or the URL pathname.
  - `parseRating(label: string | null): number | null` from `"4.8 stars"`.
  - `parseReviewCount(text: string): number | null` from the first `(1,592)`-style group.
  - `parseCategoryAndAddress(text: string, name: string): { category: string | null; address: string | null }`.
  - `classifyCard(raw: RawFeedChild, paneBounds: BoundingBox, observationId: string): ClassifiedCard`.
  - `isAd(card: ObservedCard): boolean`.
  - `LAYOUT_SIGNATURE = 'maps-feed-card/v1'`.

Classification rules: a sponsored label whose text is exactly `Sponsored` makes the card `ad` with evidence `{ source: 'card_label', owner: 'feed-child:<index>', labelText: 'Sponsored' }`. Otherwise, a card with `placeHref`, non-empty `placeAriaLabel`, and either a parseable rating label or the name appearing in `text` is `organic` with evidence `source: 'supported_layout'`. Everything else is `unknown` with `source: 'unresolved'`. `evaluatedLabelLocations` is always `['card_text', 'aria_label']`. Field parsing never changes the classification.

- [ ] **Step 1: Write the failing tests**

`tests/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyCard, isAd, parseCategoryAndAddress, parsePlaceIdentity, parseRating, parseReviewCount,
} from '../src/core/classify.js';
import type { RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
const gongChaHref = 'https://www.google.com/maps/place/Gong+Cha/data=!4m7!3m6!1s0x89c27d7c24719ab1:0x39bbfdecff1952fe!8m2!3d40.738531!4d-73.613626!16s%2Fg%2F11g6';

function raw(over: Partial<RawFeedChild>): RawFeedChild {
  return {
    index: 4, tag: 'DIV', heightPx: 230, bounds: { x: 72, y: 300, width: 408, height: 230 },
    placeHref: 'https://www.google.com/maps/place/Kyuramen+x+TBAAR+-+Garden+City/data=!4m7!3m6!1s0x89c27d2e04771bd1:0xfbb18eba1ef9912f!8m2!3d40.7292853!4d-73.6',
    placeAriaLabel: 'Kyuramen x TBAAR - Garden City', ratingAriaLabel: '4.8 stars',
    text: 'Kyuramen x TBAAR - Garden City Kyuramen x TBAAR - Garden City 4.8 (1,592) Bubble tea store · · 988 Franklin Ave Closed · Opens 11 AM Thu · (516) 385-8887 Order online',
    sponsoredLabels: [],
    ...over,
  };
}

describe('parsers', () => {
  it('extracts place identity from the href', () => {
    expect(parsePlaceIdentity(gongChaHref)).toEqual({ placeId: '0x89c27d7c24719ab1:0x39bbfdecff1952fe', placeKey: '0x89c27d7c24719ab1:0x39bbfdecff1952fe' });
    expect(parsePlaceIdentity('https://www.google.com/maps/place/X/data=!19sChIJabc_DEF-123')).toEqual({ placeId: 'ChIJabc_DEF-123', placeKey: 'ChIJabc_DEF-123' });
    expect(parsePlaceIdentity('https://www.google.com/maps/place/Only+Name/')).toEqual({ placeId: null, placeKey: '/maps/place/Only+Name/' });
  });

  it('parses rating, review count, category, and address', () => {
    expect(parseRating('4.8 stars')).toBe(4.8);
    expect(parseRating('5.0 stars')).toBe(5);
    expect(parseRating(null)).toBeNull();
    expect(parseRating('Wheelchair accessible entrance')).toBeNull();
    expect(parseReviewCount('Gong Cha 3.9 (217) Bubble tea store')).toBe(217);
    expect(parseReviewCount('Name 4.8 (1,592) Cafe')).toBe(1592);
    expect(parseReviewCount('Name 4.8 Cafe · (516) 690-8378')).toBeNull();
    expect(parseCategoryAndAddress(raw({}).text, 'Kyuramen x TBAAR - Garden City')).toEqual({ category: 'Bubble tea store', address: '988 Franklin Ave' });
    expect(parseCategoryAndAddress('Chai Shop 4.6 (81) Bubble tea store · 751 Hillside Ave. Closed · Opens 12 PM Thu', 'Chai Shop')).toEqual({ category: 'Bubble tea store', address: '751 Hillside Ave.' });
    expect(parseCategoryAndAddress('Nothing useful', 'Nothing useful')).toEqual({ category: null, address: null });
  });
});

describe('classifyCard', () => {
  it('classifies a Sponsored card as an ad with evidence and no organic rank', () => {
    const card = classifyCard(raw({
      index: 2, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha', ratingAriaLabel: '3.9 stars',
      text: 'Gong Cha Sponsored Gong Cha 3.9 (217) Bubble tea store · 630 Old Country Road Closed · Opens 11 AM Thu',
      sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }],
    }), pane, 'qa01_obs001');
    expect(card.classification).toEqual({ resultType: 'ad', adLabel: 'Sponsored', organicRank: null });
    expect(card.classificationEvidence.source).toBe('card_label');
    expect(card.classificationEvidence.owner).toBe('feed-child:2');
    expect(card.classificationEvidence.observationIds).toEqual(['qa01_obs001']);
    expect(card.businessKey).toBe('0x89c27d7c24719ab1:0x39bbfdecff1952fe');
    expect(card.parsed).toEqual({ placeId: '0x89c27d7c24719ab1:0x39bbfdecff1952fe', rating: 3.9, reviewCount: 217, category: 'Bubble tea store', address: '630 Old Country Road' });
    expect(isAd(card)).toBe(true);
  });

  it('classifies a recognized card without label as organic', () => {
    const card = classifyCard(raw({}), pane, 'qa01_obs001');
    expect(card.classification).toEqual({ resultType: 'organic', adLabel: null, organicRank: null });
    expect(card.classificationEvidence.source).toBe('supported_layout');
    expect(card.name).toBe('Kyuramen x TBAAR - Garden City');
    expect(card.parsed.reviewCount).toBe(1592);
    expect(card.fullyVisible).toBe(true);
  });

  it('marks a card with missing name or unparseable layout as unknown', () => {
    const card = classifyCard(raw({ placeAriaLabel: null, ratingAriaLabel: null, text: '' }), pane, 'qa01_obs001');
    expect(card.classification.resultType).toBe('unknown');
    expect(card.classificationEvidence.source).toBe('unresolved');
  });

  it('gives the same business different occurrence ids as ad and organic', () => {
    const ad = classifyCard(raw({ index: 2, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha', sponsoredLabels: [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] }), pane, 'o1');
    const organic = classifyCard(raw({ index: 22, placeHref: gongChaHref, placeAriaLabel: 'Gong Cha' }), pane, 'o1');
    expect(ad.occurrenceId).not.toBe(organic.occurrenceId);
    expect(ad.businessKey).toBe(organic.businessKey);
    expect(ad.fingerprint).not.toBe(organic.fingerprint);
  });

  it('computes fullyVisible against the pane', () => {
    const cut = classifyCard(raw({ bounds: { x: 72, y: 900, width: 408, height: 230 } }), pane, 'o1');
    expect(cut.fullyVisible).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/classify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/core/classify.ts`:

```ts
import type { BoundingBox, ClassificationEvidence, ListingClassification, ObservedCard } from '../contracts.js';
import { occurrenceIdFor, sha256Hex } from '../ids.js';
import type { ClassifiedCard, ParsedCardFields, RawFeedChild } from './types.js';

export const LAYOUT_SIGNATURE = 'maps-feed-card/v1';
const LABEL_LOCATIONS = ['card_text', 'aria_label'];

export function parsePlaceIdentity(href: string): { placeId: string | null; placeKey: string } {
  const hex = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(href);
  const chij = /!19s(ChIJ[\w-]+)/.exec(href);
  const placeId = hex?.[1] ?? chij?.[1] ?? null;
  if (placeId) return { placeId, placeKey: placeId };
  let pathname = href;
  try { pathname = new URL(href, 'https://www.google.com').pathname; } catch { /* keep raw href */ }
  return { placeId: null, placeKey: pathname };
}

export function parseRating(label: string | null): number | null {
  if (!label) return null;
  const m = /^(\d(?:\.\d)?) stars?$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

export function parseReviewCount(text: string): number | null {
  const m = /\((\d{1,3}(?:,\d{3})+|\d+)\)/.exec(text);
  if (!m?.[1]) return null;
  const digits = m[1].replace(/,/g, '');
  // Phone-number groups such as (516) are followed by a space and digits; require the group to be followed by a word, not more digits.
  const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2);
  if (/^\s\d/.test(after)) return null;
  return Number(digits);
}

const STATUS_WORDS = /\b(Closed|Open|Opens|Closes|Temporarily closed|Permanently closed)\b/;

export function parseCategoryAndAddress(text: string, name: string): { category: string | null; address: string | null } {
  let body = text;
  // Drop the repeated name prefix(es) and the rating/review prefix.
  while (name && body.startsWith(name)) body = body.slice(name.length).trim();
  body = body.replace(/^Sponsored\s*/, '');
  while (name && body.startsWith(name)) body = body.slice(name.length).trim();
  body = body.replace(/^\d(?:\.\d)?\s*(\(\d[\d,]*\))?\s*/, '');
  const statusAt = body.search(STATUS_WORDS);
  const head = (statusAt >= 0 ? body.slice(0, statusAt) : body).trim();
  if (!head.includes('·')) return { category: null, address: null };
  const parts = head.split('·').map((p) => p.trim()).filter((p) => p.length > 0);
  const category = parts[0] ?? null;
  const address = parts.length >= 2 ? parts[parts.length - 1] ?? null : null;
  return { category, address };
}

function withinPane(b: BoundingBox, pane: BoundingBox): boolean {
  return b.y >= pane.y - 0.5 && b.y + b.height <= pane.y + pane.height + 0.5 && b.height > 0;
}

export function isAd(card: ObservedCard): boolean {
  return card.classification.resultType === 'ad';
}

export function classifyCard(raw: RawFeedChild, paneBounds: BoundingBox, observationId: string): ClassifiedCard {
  const name = raw.placeAriaLabel?.trim() ?? null;
  const identity = raw.placeHref ? parsePlaceIdentity(raw.placeHref) : { placeId: null, placeKey: `feed-child:${raw.index}` };
  const sponsored = raw.sponsoredLabels.find((l) => l.text.trim() === 'Sponsored') ?? null;
  const rating = parseRating(raw.ratingAriaLabel);
  const layoutRecognized = raw.placeHref !== null && name !== null && (rating !== null || raw.text.includes(name));

  let classification: ListingClassification;
  let evidence: ClassificationEvidence;
  if (sponsored) {
    classification = { resultType: 'ad', adLabel: 'Sponsored', organicRank: null };
    evidence = { source: 'card_label', owner: `feed-child:${raw.index}`, labelText: sponsored.text, layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  } else if (layoutRecognized) {
    classification = { resultType: 'organic', adLabel: null, organicRank: null };
    evidence = { source: 'supported_layout', owner: `feed-child:${raw.index}`, labelText: null, layoutSignature: LAYOUT_SIGNATURE, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  } else {
    classification = { resultType: 'unknown', adLabel: null, organicRank: null };
    evidence = { source: 'unresolved', owner: null, labelText: null, layoutSignature: null, evaluatedLabelLocations: LABEL_LOCATIONS, observationIds: [observationId] };
  }

  const isAdCard = classification.resultType === 'ad';
  const parsedFields = name ? parseCategoryAndAddress(raw.text, name) : { category: null, address: null };
  const parsed: ParsedCardFields = {
    placeId: identity.placeId,
    rating,
    reviewCount: parseReviewCount(raw.text),
    category: parsedFields.category,
    address: parsedFields.address,
  };

  return {
    fingerprint: sha256Hex(`${identity.placeKey}|${isAdCard ? 'ad' : 'organic'}|${raw.index}`).slice(0, 24),
    feedChildIndex: raw.index,
    occurrenceId: occurrenceIdFor({ placeKey: identity.placeKey, isAd: isAdCard, feedChildIndex: raw.index }),
    businessKey: identity.placeId,
    name,
    mapsUrl: raw.placeHref,
    rawText: raw.text,
    bounds: raw.bounds,
    fullyVisible: withinPane(raw.bounds, paneBounds),
    classification,
    classificationEvidence: evidence,
    parsed,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/classify.test.ts && npm run typecheck`
Expected: 7 passed. If `parseCategoryAndAddress` fails on the `raw({}).text` sample because of the doubled `· ·`, the filter on empty parts already handles it; check the status-word split first.

- [ ] **Step 5: Commit**

```bash
git add src/core/classify.ts tests/classify.test.ts
git commit -m "feat: classify feed cards as ad, organic, or unknown with evidence"
```

---

### Task 7: Overlap reconciliation into a verified prefix

**Files:**
- Create: `src/core/reconcile.ts`, `tests/reconcile.test.ts`

**Interfaces:**
- Consumes: `ClassifiedCard`, `FeedLayout` from `src/core/types.ts`; `QueryQuality` from `src/contracts.ts`.
- Produces:

```ts
export interface ReconcileRound { observationId: string; layout: FeedLayout; cards: ClassifiedCard[] }
export interface CommittedCard { card: ClassifiedCard; observationIds: string[] }
export interface ReconcileFailure { reason: 'sequence_ambiguous' | 'unsupported_layout'; detail: string; atIndex: number | null }
export interface ReconcileState {
  committed: CommittedCard[];
  stride: number | null;
  firstCardIndex: number | null;
  failure: ReconcileFailure | null;
  warnings: QueryQuality['warnings'];
}
export function createReconcileState(): ReconcileState
export function applyRound(state: ReconcileState, round: ReconcileRound, limit: number): ReconcileState
export function lastCommittedIndex(state: ReconcileState): number | null
```

`applyRound` is pure and returns a new state. It never appends after a failure. Rules, in order:
1. The first round fixes `stride` and `firstCardIndex`. A later round whose layout reports a different `stride` fails with `unsupported_layout`. (`firstCardIndex` is kept from the first round only; later rounds may start anywhere.)
2. Cards must have strictly increasing `bounds.y` in index order; otherwise `sequence_ambiguous`.
3. For every committed card whose index appears in the round: `businessKey` (or `mapsUrl` when both keys are null), ad flag, and `name` must match; otherwise `sequence_ambiguous` at that index and the committed list is truncated to the cards before that index. A committed `occurrenceId` seen at a different index also fails.
4. A committed index that lies inside the round's index range but is absent from the round is a disappearance and fails.
5. New cards must start at `lastCommittedIndex + stride` (or `firstCardIndex` when nothing is committed) and continue with the stride; a gap fails at the gap. Append until `committed.length === limit`.
6. Re-observed committed cards accumulate the round's `observationId`.

- [ ] **Step 1: Write the failing tests**

`tests/reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import { applyRound, createReconcileState, lastCommittedIndex, type ReconcileRound } from '../src/core/reconcile.js';
import type { ClassifiedCard, RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };

function rawCard(index: number, name: string, opts: { ad?: boolean; y?: number; id?: string } = {}): RawFeedChild {
  const id = opts.id ?? `0x${index}:0x${name.length}`;
  return {
    index, tag: 'DIV', heightPx: 200, bounds: { x: 72, y: opts.y ?? 80 + (index / 2) * 200, width: 408, height: 200 },
    placeHref: `https://www.google.com/maps/place/${encodeURIComponent(name)}/data=!1s${id}`,
    placeAriaLabel: name, ratingAriaLabel: '4.5 stars',
    text: `${name}${opts.ad ? ' Sponsored' : ''} ${name} 4.5 (10) Cafe · 1 Main St Closed`,
    sponsoredLabels: opts.ad ? [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] : [],
  };
}
function sep(index: number): RawFeedChild {
  return { index, tag: 'DIV', heightPx: 1, bounds: { x: 72, y: 0, width: 408, height: 1 }, placeHref: null, placeAriaLabel: null, ratingAriaLabel: null, text: '', sponsoredLabels: [] };
}
/** Build a round from card specs [index, name, opts]; separators are inserted automatically at odd indices. */
function round(observationId: string, specs: [number, string, { ad?: boolean; y?: number; id?: string }?][]): ReconcileRound {
  const children: RawFeedChild[] = [];
  for (const [index, name, opts] of specs) {
    if (children.length > 0) children.push(sep(index - 1));
    children.push(rawCard(index, name, opts ?? {}));
  }
  const layoutResult = classifyFeedChildren(children);
  if (!layoutResult.ok) throw new Error(layoutResult.detail);
  const cards: ClassifiedCard[] = layoutResult.layout.cards.map((c) => classifyCard(c, pane, observationId));
  return { observationId, layout: layoutResult.layout, cards };
}

describe('applyRound', () => {
  it('merges three overlapping rounds into an ordered prefix without double counting', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B'], [6, 'C'], [8, 'D'], [10, 'E']]), 15);
    s = applyRound(s, round('o2', [[10, 'E'], [12, 'F'], [14, 'G'], [16, 'H'], [18, 'I']]), 15);
    s = applyRound(s, round('o3', [[18, 'I'], [20, 'J'], [22, 'K']]), 15);
    expect(s.failure).toBeNull();
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);
    expect(s.committed[4]!.observationIds).toEqual(['o1', 'o2']);
    expect(lastCommittedIndex(s)).toBe(22);
  });

  it('keeps ad and organic occurrences of one business as two entries', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'Gong Cha', { ad: true, id: '0xg:0xc' }], [4, 'B'], [6, 'Gong Cha', { id: '0xg:0xc' }]]), 15);
    expect(s.committed).toHaveLength(3);
    expect(s.committed[0]!.card.classification.resultType).toBe('ad');
    expect(s.committed[2]!.card.classification.resultType).toBe('organic');
    expect(s.committed[0]!.card.businessKey).toBe(s.committed[2]!.card.businessKey);
  });

  it('truncates to the limit', () => {
    const s = applyRound(createReconcileState(), round('o1', [[2, 'A'], [4, 'B'], [6, 'C']]), 2);
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B']);
  });

  it('fails on same-index replacement and keeps the prefix before it', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B'], [6, 'C']]), 15);
    s = applyRound(s, round('o2', [[2, 'A'], [4, 'X'], [6, 'C'], [8, 'D']]), 15);
    expect(s.failure).toMatchObject({ reason: 'sequence_ambiguous', atIndex: 4 });
    expect(s.committed.map((c) => c.card.name)).toEqual(['A']);
  });

  it('fails when a committed card changes ad type', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { ad: true }], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[2, 'A'], [4, 'B']]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
    expect(s.committed).toHaveLength(0);
  });

  it('fails on an index gap and keeps the prefix', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[8, 'D'], [10, 'E']]), 15);
    expect(s.failure).toMatchObject({ reason: 'sequence_ambiguous', atIndex: 8 });
    expect(s.committed.map((c) => c.card.name)).toEqual(['A', 'B']);
  });

  it('fails when a known occurrence moves to another index', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { id: '0xa:0x1' }], [4, 'B']]), 15);
    s = applyRound(s, round('o2', [[2, 'Z'], [4, 'B'], [6, 'A', { id: '0xa:0x1' }]]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
  });

  it('fails when visual order disagrees with index order', () => {
    const s = applyRound(createReconcileState(), round('o1', [[2, 'A', { y: 500 }], [4, 'B', { y: 100 }]]), 15);
    expect(s.failure?.reason).toBe('sequence_ambiguous');
    expect(s.committed).toHaveLength(0);
  });

  it('fails when the stride changes between rounds', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A'], [4, 'B']]), 15);
    const odd = round('o2', [[4, 'B'], [6, 'C']]);
    odd.layout = { ...odd.layout, stride: 3 };
    s = applyRound(s, odd, 15);
    expect(s.failure?.reason).toBe('unsupported_layout');
  });

  it('does nothing after a failure', () => {
    let s = createReconcileState();
    s = applyRound(s, round('o1', [[2, 'A', { y: 500 }], [4, 'B', { y: 100 }]]), 15);
    const again = applyRound(s, round('o2', [[2, 'A'], [4, 'B']]), 15);
    expect(again).toBe(s);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/reconcile.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/core/reconcile.ts`:

```ts
import type { QueryQuality } from '../contracts.js';
import type { ClassifiedCard, FeedLayout } from './types.js';

export interface ReconcileRound { observationId: string; layout: FeedLayout; cards: ClassifiedCard[] }
export interface CommittedCard { card: ClassifiedCard; observationIds: string[] }
export interface ReconcileFailure { reason: 'sequence_ambiguous' | 'unsupported_layout'; detail: string; atIndex: number | null }
export interface ReconcileState {
  committed: CommittedCard[];
  stride: number | null;
  firstCardIndex: number | null;
  failure: ReconcileFailure | null;
  warnings: QueryQuality['warnings'];
}

export function createReconcileState(): ReconcileState {
  return { committed: [], stride: null, firstCardIndex: null, failure: null, warnings: [] };
}

export function lastCommittedIndex(state: ReconcileState): number | null {
  const last = state.committed[state.committed.length - 1];
  return last ? last.card.feedChildIndex : null;
}

function identityKey(card: ClassifiedCard): string {
  return card.businessKey ?? card.mapsUrl ?? `feed-child:${card.feedChildIndex}`;
}

function fail(state: ReconcileState, committed: CommittedCard[], failure: ReconcileFailure): ReconcileState {
  return { ...state, committed, failure };
}

export function applyRound(state: ReconcileState, round: ReconcileRound, limit: number): ReconcileState {
  if (state.failure) return state;
  const cards = [...round.cards].sort((a, b) => a.feedChildIndex - b.feedChildIndex);

  // 1. The card stride must not change between rounds.
  const stride = state.stride ?? round.layout.stride;
  const firstCardIndex = state.firstCardIndex ?? round.layout.firstCardIndex;
  if (round.layout.stride !== stride) {
    return fail(state, state.committed, { reason: 'unsupported_layout', detail: `card stride changed from ${stride} to ${round.layout.stride}`, atIndex: null });
  }

  // 2. Visual order must follow index order.
  for (let i = 1; i < cards.length; i++) {
    if (cards[i]!.bounds.y <= cards[i - 1]!.bounds.y) {
      return fail(state, [], { reason: 'sequence_ambiguous', detail: `card at index ${cards[i]!.feedChildIndex} is not below index ${cards[i - 1]!.feedChildIndex}`, atIndex: cards[i]!.feedChildIndex });
    }
  }

  const byIndex = new Map<number, ClassifiedCard>(cards.map((c) => [c.feedChildIndex, c]));
  const roundMin = cards[0]?.feedChildIndex ?? Number.POSITIVE_INFINITY;
  const roundMax = cards[cards.length - 1]?.feedChildIndex ?? Number.NEGATIVE_INFINITY;
  const knownOccurrenceIndex = new Map(state.committed.map((c) => [c.card.occurrenceId, c.card.feedChildIndex]));

  // 3 and 4. Re-verify the committed prefix.
  const committed: CommittedCard[] = [];
  for (const entry of state.committed) {
    const idx = entry.card.feedChildIndex;
    const seen = byIndex.get(idx);
    if (!seen) {
      if (idx >= roundMin && idx <= roundMax) {
        return fail(state, committed, { reason: 'sequence_ambiguous', detail: `committed card at index ${idx} disappeared`, atIndex: idx });
      }
      committed.push(entry);
      continue;
    }
    const same = identityKey(seen) === identityKey(entry.card)
      && (seen.classification.resultType === 'ad') === (entry.card.classification.resultType === 'ad')
      && seen.name === entry.card.name;
    if (!same) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `card at index ${idx} changed from "${entry.card.name}" to "${seen.name}"`, atIndex: idx });
    }
    committed.push({ card: entry.card, observationIds: [...entry.observationIds, round.observationId] });
  }
  for (const c of cards) {
    const knownAt = knownOccurrenceIndex.get(c.occurrenceId);
    if (knownAt !== undefined && knownAt !== c.feedChildIndex) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `occurrence ${c.occurrenceId} moved from index ${knownAt} to ${c.feedChildIndex}`, atIndex: c.feedChildIndex });
    }
  }

  // 5. Append a contiguous new suffix.
  let expected = committed.length === 0 ? firstCardIndex : committed[committed.length - 1]!.card.feedChildIndex + stride;
  for (const c of cards) {
    if (committed.length >= limit) break;
    if (c.feedChildIndex < expected) continue;
    if (c.feedChildIndex !== expected) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `expected card at index ${expected}, found ${c.feedChildIndex}`, atIndex: c.feedChildIndex });
    }
    committed.push({ card: c, observationIds: [round.observationId] });
    expected += stride;
  }

  return { ...state, committed, stride, firstCardIndex };
}
```

Note on the "known occurrence moved" test: because `occurrenceId` includes the feed index, a moved card gets a new id; the test's reorder is caught by rule 3 (index 2 now shows "Z"). Keep rule 3's check anyway for the case where ids are computed from stable place identifiers in a later adapter version.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reconcile.test.ts && npm run typecheck`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/reconcile.ts tests/reconcile.test.ts
git commit -m "feat: reconcile overlapping feed observations into a verified prefix"
```

---

### Task 8: Ranking and collection outcome

**Files:**
- Create: `src/core/ranking.ts`, `src/core/outcome.ts`, `tests/ranking.test.ts`, `tests/outcome.test.ts`

**Interfaces:**
- Consumes: `CommittedCard` from `src/core/reconcile.ts`; `Listing`, `CollectionOutcome`, `CompleteReason`, `IncompleteReason`, `BlockReason`, `CaptureError` from `src/contracts.ts`.
- Produces:

```ts
// ranking.ts
export interface RankedCard { committed: CommittedCard; displayPosition: number; organicRank: number | null }
export function assignRanks(committed: CommittedCard[]): { ranked: RankedCard[]; classificationComplete: boolean }
export function toListing(r: RankedCard, screenshotIds: string[]): Listing

// outcome.ts
export type StopCause =
  | { kind: 'complete'; reason: CompleteReason }
  | { kind: 'incomplete'; reason: IncompleteReason; error: CaptureError | null }
  | { kind: 'blocked'; reason: BlockReason; error: CaptureError | null }
  | { kind: 'failed'; reason: IncompleteReason | 'browser_startup_failed'; error: CaptureError };
export interface OutcomeInput {
  stop: StopCause;
  sequenceVerified: boolean;
  classificationComplete: boolean;
  screenshotCoverageComplete: boolean;
  listingCount: number;
}
export function deriveOutcome(input: OutcomeInput): CollectionOutcome
```

Ranking: `displayPosition` is 1..N in committed order. The organic counter increments only on `organic` cards. The first `unknown` sets every later `organicRank` to null and makes `classificationComplete` false. Ads always get null.

Outcome: `complete` with all three flags true is `captured`. `complete` with `classificationComplete` false is `partial / classification_unknown`; with `screenshotCoverageComplete` false is `partial / screenshot_limit`; with `sequenceVerified` false is `partial / sequence_ambiguous` (checked in that order). `incomplete` is `partial`, except `timeout` or `error` with zero listings, which is `failed` with a synthesized error `{ code: reason, message }` when none is given. `blocked` and `failed` pass through.

- [ ] **Step 1: Write the failing tests**

`tests/ranking.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyCard } from '../src/core/classify.js';
import { assignRanks, toListing } from '../src/core/ranking.js';
import type { CommittedCard } from '../src/core/reconcile.js';
import type { RawFeedChild } from '../src/core/types.js';

const pane = { x: 72, y: 80, width: 408, height: 875 };
function committed(index: number, name: string, kind: 'ad' | 'organic' | 'unknown'): CommittedCard {
  const raw: RawFeedChild = {
    index, tag: 'DIV', heightPx: 200, bounds: { x: 72, y: 80 + index * 100, width: 408, height: 200 },
    placeHref: kind === 'unknown' ? null : `https://www.google.com/maps/place/${name}/data=!1s0x${index}:0x1`,
    placeAriaLabel: kind === 'unknown' ? null : name, ratingAriaLabel: kind === 'unknown' ? null : '4.0 stars',
    text: kind === 'unknown' ? '' : `${name} 4.0 (12) Cafe · 1 St Closed`,
    sponsoredLabels: kind === 'ad' ? [{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: 6 }] : [],
  };
  return { card: classifyCard(raw, pane, 'o1'), observationIds: ['o1'] };
}

describe('assignRanks', () => {
  it('counts ads in display position but not in organic rank', () => {
    const { ranked, classificationComplete } = assignRanks([
      committed(2, 'A', 'ad'), committed(4, 'B', 'organic'), committed(6, 'C', 'organic'), committed(8, 'D', 'ad'), committed(10, 'E', 'organic'),
    ]);
    expect(ranked.map((r) => [r.displayPosition, r.organicRank])).toEqual([[1, null], [2, 1], [3, 2], [4, null], [5, 3]]);
    expect(classificationComplete).toBe(true);
  });

  it('nulls organic ranks after the first unknown', () => {
    const { ranked, classificationComplete } = assignRanks([
      committed(2, 'A', 'organic'), committed(4, 'B', 'unknown'), committed(6, 'C', 'organic'), committed(8, 'D', 'organic'),
    ]);
    expect(ranked.map((r) => r.organicRank)).toEqual([1, null, null, null]);
    expect(ranked.map((r) => r.displayPosition)).toEqual([1, 2, 3, 4]);
    expect(classificationComplete).toBe(false);
  });

  it('builds listings with the classification variant matching the rank', () => {
    const { ranked } = assignRanks([committed(2, 'A', 'ad'), committed(4, 'B', 'organic')]);
    const ad = toListing(ranked[0]!, ['s1']);
    const organic = toListing(ranked[1]!, ['s1', 's2']);
    expect(ad).toMatchObject({ resultType: 'ad', adLabel: 'Sponsored', organicRank: null, displayPosition: 1, screenshotIds: ['s1'] });
    expect(organic).toMatchObject({ resultType: 'organic', adLabel: null, organicRank: 1, displayPosition: 2, name: 'B', rating: 4, reviewCount: 12, category: 'Cafe', address: '1 St' });
    expect(organic.observationIds).toEqual(['o1']);
  });
});
```

`tests/outcome.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveOutcome, type OutcomeInput } from '../src/core/outcome.js';

const good = { sequenceVerified: true, classificationComplete: true, screenshotCoverageComplete: true, listingCount: 15 };

describe('deriveOutcome', () => {
  const cases: [string, OutcomeInput, Record<string, unknown>][] = [
    ['limit reached', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good }, { status: 'captured', stopReason: 'limit_reached', error: null }],
    ['end of results with 7', { stop: { kind: 'complete', reason: 'end_of_results' }, ...good, listingCount: 7 }, { status: 'captured', stopReason: 'end_of_results' }],
    ['unknown classification', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, classificationComplete: false }, { status: 'partial', stopReason: 'classification_unknown' }],
    ['missing screenshot coverage', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, screenshotCoverageComplete: false }, { status: 'partial', stopReason: 'screenshot_limit' }],
    ['unverified sequence', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, sequenceVerified: false }, { status: 'partial', stopReason: 'sequence_ambiguous' }],
    ['scroll limit', { stop: { kind: 'incomplete', reason: 'scroll_limit', error: null }, ...good, listingCount: 9 }, { status: 'partial', stopReason: 'scroll_limit' }],
    ['timeout with evidence', { stop: { kind: 'incomplete', reason: 'timeout', error: null }, ...good, listingCount: 3 }, { status: 'partial', stopReason: 'timeout' }],
    ['timeout without evidence', { stop: { kind: 'incomplete', reason: 'timeout', error: null }, ...good, listingCount: 0 }, { status: 'failed', stopReason: 'timeout', error: { code: 'timeout', message: expect.any(String) } }],
    ['captcha', { stop: { kind: 'blocked', reason: 'captcha', error: null }, ...good, listingCount: 0 }, { status: 'blocked', stopReason: 'captcha' }],
    ['browser startup', { stop: { kind: 'failed', reason: 'browser_startup_failed', error: { code: 'launch', message: 'x' } }, ...good, listingCount: 0 }, { status: 'failed', stopReason: 'browser_startup_failed' }],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(deriveOutcome(input)).toMatchObject(expected));
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ranking.test.ts tests/outcome.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/core/ranking.ts`:

```ts
import type { Listing, ListingClassification } from '../contracts.js';
import type { CommittedCard } from './reconcile.js';

export interface RankedCard { committed: CommittedCard; displayPosition: number; organicRank: number | null }

export function assignRanks(committed: CommittedCard[]): { ranked: RankedCard[]; classificationComplete: boolean } {
  const ranked: RankedCard[] = [];
  let organicCounter = 0;
  let afterUnknown = false;
  for (const [i, entry] of committed.entries()) {
    const type = entry.card.classification.resultType;
    if (type === 'unknown') afterUnknown = true;
    let organicRank: number | null = null;
    if (type === 'organic' && !afterUnknown) {
      organicCounter += 1;
      organicRank = organicCounter;
    }
    ranked.push({ committed: entry, displayPosition: i + 1, organicRank });
  }
  return { ranked, classificationComplete: !afterUnknown };
}

function classificationFor(r: RankedCard): ListingClassification {
  const c = r.committed.card.classification;
  switch (c.resultType) {
    case 'ad': return { resultType: 'ad', adLabel: c.adLabel, organicRank: null };
    case 'organic': return { resultType: 'organic', adLabel: null, organicRank: r.organicRank };
    case 'unknown': return { resultType: 'unknown', adLabel: c.adLabel, organicRank: null };
  }
}

export function toListing(r: RankedCard, screenshotIds: string[]): Listing {
  const card = r.committed.card;
  return {
    ...classificationFor(r),
    occurrenceId: card.occurrenceId,
    businessKey: card.businessKey,
    displayPosition: r.displayPosition,
    name: card.name ?? '',
    address: card.parsed.address,
    mapsUrl: card.mapsUrl,
    placeId: card.parsed.placeId,
    rating: card.parsed.rating,
    reviewCount: card.parsed.reviewCount,
    category: card.parsed.category,
    rawText: card.rawText,
    classificationEvidence: { ...card.classificationEvidence, observationIds: [...r.committed.observationIds] },
    observationIds: [...r.committed.observationIds],
    screenshotIds: [...screenshotIds],
  };
}
```

`src/core/outcome.ts`:

```ts
import type { BlockReason, CaptureError, CollectionOutcome, CompleteReason, IncompleteReason } from '../contracts.js';

export type StopCause =
  | { kind: 'complete'; reason: CompleteReason }
  | { kind: 'incomplete'; reason: IncompleteReason; error: CaptureError | null }
  | { kind: 'blocked'; reason: BlockReason; error: CaptureError | null }
  | { kind: 'failed'; reason: IncompleteReason | 'browser_startup_failed'; error: CaptureError };

export interface OutcomeInput {
  stop: StopCause;
  sequenceVerified: boolean;
  classificationComplete: boolean;
  screenshotCoverageComplete: boolean;
  listingCount: number;
}

export function deriveOutcome(input: OutcomeInput): CollectionOutcome {
  const { stop } = input;
  switch (stop.kind) {
    case 'complete':
      if (!input.classificationComplete) return { status: 'partial', stopReason: 'classification_unknown', error: null };
      if (!input.screenshotCoverageComplete) return { status: 'partial', stopReason: 'screenshot_limit', error: null };
      if (!input.sequenceVerified) return { status: 'partial', stopReason: 'sequence_ambiguous', error: null };
      return { status: 'captured', stopReason: stop.reason, error: null };
    case 'incomplete':
      if (input.listingCount === 0 && (stop.reason === 'timeout' || stop.reason === 'error')) {
        return { status: 'failed', stopReason: stop.reason, error: stop.error ?? { code: stop.reason, message: `no listings collected before ${stop.reason}` } };
      }
      return { status: 'partial', stopReason: stop.reason, error: stop.error };
    case 'blocked':
      return { status: 'blocked', stopReason: stop.reason, error: stop.error };
    case 'failed':
      return { status: 'failed', stopReason: stop.reason, error: stop.error };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/ranking.test.ts tests/outcome.test.ts && npm run typecheck`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/ranking.ts src/core/outcome.ts tests/ranking.test.ts tests/outcome.test.ts
git commit -m "feat: assign display positions, organic ranks, and collection outcomes"
```

---

### Task 9: CSV export

**Files:**
- Create: `src/export/csv.ts`, `tests/csv.test.ts`

**Interfaces:**
- Consumes: `KeywordResult`, `Listing`, `ScreenshotArtifact` from `src/contracts.ts`.
- Produces:
  - `CSV_COLUMNS` (readonly tuple, in this order): `run_id, attempt_id, query_id, keyword, captured_at, profile_hash, display_position, result_type, organic_rank, name, address, rating, review_count, category, maps_url, place_id, ad_label, screenshot_files`
  - `csvEscape(value: string | number | null): string`
  - `resultToCsv(result: KeywordResult): string` with a UTF-8 BOM, CRLF line endings, header row always present; `screenshot_files` joins screenshot filenames with `;`; `captured_at` is `result.finishedAt`.

Escaping: null becomes an empty cell. Any value starting with `=`, `+`, `-`, `@`, tab, or carriage return gets a leading apostrophe. Values containing `"`, `,`, `\r`, or `\n` are quoted with doubled quotes.

- [ ] **Step 1: Write the failing tests**

`tests/csv.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/csv.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/export/csv.ts`:

```ts
import type { KeywordResult } from '../contracts.js';

export const CSV_COLUMNS = [
  'run_id', 'attempt_id', 'query_id', 'keyword', 'captured_at', 'profile_hash',
  'display_position', 'result_type', 'organic_rank', 'name', 'address', 'rating',
  'review_count', 'category', 'maps_url', 'place_id', 'ad_label', 'screenshot_files',
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function resultToCsv(result: KeywordResult): string {
  const filenameById = new Map(result.screenshots.map((s) => [s.id, s.filename]));
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const l of result.listings) {
    const files = l.screenshotIds.map((id) => filenameById.get(id) ?? id).join(';');
    const cells: (string | number | null)[] = [
      result.runId, result.attemptId, result.queryId, result.keyword, result.finishedAt, result.metadata.profileHash,
      l.displayPosition, l.resultType, l.organicRank, l.name, l.address, l.rating,
      l.reviewCount, l.category, l.mapsUrl, l.placeId, l.adLabel, files,
    ];
    rows.push(cells.map(csvEscape).join(','));
  }
  return `﻿${rows.join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/csv.test.ts && npm run typecheck`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/export/csv.ts tests/csv.test.ts
git commit -m "feat: export listings to CSV with formula guarding"
```

---

### Task 10: Local artifact store and manifest bookkeeping

**Files:**
- Create: `src/storage/types.ts`, `src/storage/local.ts`, `src/runner/manifest.ts`, `tests/local-store.test.ts`, `tests/manifest.test.ts`

**Interfaces:**
- Produces (`src/storage/types.ts`):

```ts
import type { StorageState } from '../contracts.js';
export interface WrittenFile { relativePath: string; bytes: number; sha256: string }
export interface ArtifactStore {
  readonly mode: 'local_only' | 'azure_blob';
  readonly rootDirectory: string;
  /** Atomic local write (temp file + rename). relativePath uses forward slashes. */
  writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile>;
  /** Local mode never uploads; returns the local_only state. */
  persist(file: WrittenFile): Promise<StorageState>;
}
```

- Produces (`src/storage/local.ts`): `class LocalArtifactStore implements ArtifactStore { constructor(rootDirectory: string) }` and `absolutePath(relativePath: string): string`.

- Produces (`src/runner/manifest.ts`):

```ts
export function createManifest(args: { runId: string; attemptId: string; startedAt: string; metadata: RunMetadata; persistenceMode: BatchManifest['persistenceMode']; keywords: string[] }): BatchManifest
export function markRunning(m: BatchManifest, queryId: string): BatchManifest
export function recordQueryAttempt(m: BatchManifest, queryId: string, summary: QueryAttemptSummary, artifacts: Artifact[]): BatchManifest
export function markSkipped(m: BatchManifest, queryId: string, reason: SkipReason): BatchManifest
export function selectAttempt(attempts: QueryAttemptSummary[]): QueryAttemptSummary
export function finalizeManifest(m: BatchManifest, finishedAt: string): BatchManifest
export function exitCodeFor(m: BatchManifest): 0 | 1 | 2
```

Rules: `createManifest` gives every keyword a `pending` row with `queryId = queryIdFor(index)` and `inputIndex = index`. `recordQueryAttempt` appends the summary, appends artifacts to `m.artifacts`, selects with `selectAttempt`, copies the selected attempt's `status`, `stopReason`, `error`, `resultFile`, and sets `artifactIds` to all artifact ids of all attempts, `persistenceStatus` to `not_requested` when `persistenceMode` is `local_only`, else `pending`. `selectAttempt` returns the earliest `captured`, else the earliest `partial` or `blocked`, else the earliest `failed`. `finalizeManifest` sets `finishedAt` and `status`: `completed` when every row is `captured`; `failed` when no row is `captured`, `partial`, or `blocked`; otherwise `partial`. `exitCodeFor`: `0` for `completed`, `1` for `failed`, `2` for `partial`.

- [ ] **Step 1: Write the failing tests**

`tests/local-store.test.ts`:

```ts
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from '../src/storage/local.js';
import { sha256Hex } from '../src/ids.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('LocalArtifactStore', () => {
  it('writes nested files atomically and reports size and hash', async () => {
    const store = new LocalArtifactStore(root);
    const written = await store.writeFile('a/b/c.txt', 'hello');
    expect(written).toEqual({ relativePath: 'a/b/c.txt', bytes: 5, sha256: sha256Hex('hello') });
    expect(await readFile(join(root, 'a/b/c.txt'), 'utf8')).toBe('hello');
    expect((await readdir(join(root, 'a/b'))).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('overwrites on rewrite and reports local_only persistence', async () => {
    const store = new LocalArtifactStore(root);
    await store.writeFile('m.json', '{"a":1}');
    const second = await store.writeFile('m.json', '{"a":2}');
    expect(await readFile(join(root, 'm.json'), 'utf8')).toBe('{"a":2}');
    expect(await store.persist(second)).toEqual({ storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null });
    expect(store.mode).toBe('local_only');
  });
});
```

`tests/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Artifact, QueryAttemptSummary, RunMetadata } from '../src/contracts.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordQueryAttempt, selectAttempt } from '../src/runner/manifest.js';

const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };
function summary(id: string, status: QueryAttemptSummary['status'], stopReason: QueryAttemptSummary['stopReason']): QueryAttemptSummary {
  const error = status === 'failed' ? { code: 'x', message: 'x' } : null;
  return { queryAttemptId: id, startedAt: 't0', finishedAt: 't1', resultFile: `q0001/${id}/r.json`, artifactIds: [`${id}-a`], status, stopReason, error } as QueryAttemptSummary;
}
function artifact(id: string): Artifact {
  return { id, filename: 'f', kind: 'result_json', bytes: 1, sha256: 'h', queryId: 'q0001', queryAttemptId: 'qa01', storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null };
}
const base = () => createManifest({ runId: 'run_1', attemptId: 'att_1', startedAt: 't0', metadata, persistenceMode: 'local_only', keywords: ['a', 'b', 'a'] });

describe('manifest', () => {
  it('creates pending rows for every input row including duplicates', () => {
    const m = base();
    expect(m.status).toBe('running');
    expect(m.queries.map((q) => [q.queryId, q.inputIndex, q.keyword, q.status])).toEqual([['q0001', 0, 'a', 'pending'], ['q0002', 1, 'b', 'pending'], ['q0003', 2, 'a', 'pending']]);
    expect(m.queries[0]).toMatchObject({ persistenceStatus: 'not_requested', selectedQueryAttemptId: null, attempts: [] });
  });

  it('records attempts, selects by policy, and lists artifacts', () => {
    let m = markRunning(base(), 'q0001');
    expect(m.queries[0]!.status).toBe('running');
    m = recordQueryAttempt(m, 'q0001', summary('qa01', 'failed', 'error'), [artifact('qa01-a')]);
    expect(m.queries[0]).toMatchObject({ status: 'failed', selectedQueryAttemptId: 'qa01', resultFile: 'q0001/qa01/r.json', persistenceStatus: 'not_requested' });
    m = recordQueryAttempt(m, 'q0001', summary('qa02', 'captured', 'limit_reached'), [artifact('qa02-a')]);
    expect(m.queries[0]).toMatchObject({ status: 'captured', stopReason: 'limit_reached', selectedQueryAttemptId: 'qa02', artifactIds: ['qa01-a', 'qa02-a'] });
    expect(m.artifacts.map((a) => a.id)).toEqual(['qa01-a', 'qa02-a']);
  });

  it('selects the earliest captured, then earliest with evidence, then earliest failed', () => {
    expect(selectAttempt([summary('qa01', 'partial', 'timeout'), summary('qa02', 'captured', 'limit_reached')]).queryAttemptId).toBe('qa02');
    expect(selectAttempt([summary('qa01', 'failed', 'error'), summary('qa02', 'blocked', 'captcha')]).queryAttemptId).toBe('qa02');
    expect(selectAttempt([summary('qa01', 'failed', 'error'), summary('qa02', 'failed', 'timeout')]).queryAttemptId).toBe('qa01');
  });

  it('marks skipped rows with a reason and no result', () => {
    const m = markSkipped(base(), 'q0002', 'batch_blocked');
    expect(m.queries[1]).toMatchObject({ status: 'skipped', stopReason: 'batch_blocked', selectedQueryAttemptId: null, resultFile: null, attempts: [], artifactIds: [], persistenceStatus: 'not_requested' });
  });

  it('finalizes status and exit code', () => {
    let m = base();
    for (const q of ['q0001', 'q0002', 'q0003']) m = recordQueryAttempt(m, q, summary('qa01', 'captured', 'limit_reached'), []);
    const done = finalizeManifest(m, 't9');
    expect(done).toMatchObject({ status: 'completed', finishedAt: 't9' });
    expect(exitCodeFor(done)).toBe(0);

    let p = recordQueryAttempt(base(), 'q0001', summary('qa01', 'captured', 'limit_reached'), []);
    p = markSkipped(p, 'q0002', 'batch_blocked');
    p = markSkipped(p, 'q0003', 'batch_blocked');
    expect(finalizeManifest(p, 't9').status).toBe('partial');
    expect(exitCodeFor(finalizeManifest(p, 't9'))).toBe(2);

    let f = base();
    for (const q of ['q0001', 'q0002', 'q0003']) f = recordQueryAttempt(f, q, summary('qa01', 'failed', 'error'), []);
    expect(finalizeManifest(f, 't9').status).toBe('failed');
    expect(exitCodeFor(finalizeManifest(f, 't9'))).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/local-store.test.ts tests/manifest.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/storage/types.ts`: exactly the interface block above.

`src/storage/local.ts`:

```ts
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { StorageState } from '../contracts.js';
import { sha256Hex } from '../ids.js';
import type { ArtifactStore, WrittenFile } from './types.js';

export class LocalArtifactStore implements ArtifactStore {
  readonly mode = 'local_only' as const;
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  absolutePath(relativePath: string): string {
    return join(this.rootDirectory, ...relativePath.split('/'));
  }

  async writeFile(relativePath: string, data: Buffer | string): Promise<WrittenFile> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const finalPath = this.absolutePath(relativePath);
    await mkdir(dirname(finalPath), { recursive: true });
    const tmpPath = `${finalPath}.tmp-${randomBytes(4).toString('hex')}`;
    const handle = await open(tmpPath, 'w');
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    return { relativePath, bytes: buffer.byteLength, sha256: sha256Hex(buffer) };
  }

  async persist(_file: WrittenFile): Promise<StorageState> {
    return { storageStatus: 'local_only', objectKey: null, verifiedAt: null, storageError: null };
  }
}
```

`src/runner/manifest.ts`:

```ts
import type { Artifact, BatchManifest, QueryAttemptSummary, QueryManifestEntry, RunMetadata, SkipReason } from '../contracts.js';
import { queryIdFor } from '../ids.js';

export function createManifest(args: {
  runId: string; attemptId: string; startedAt: string; metadata: RunMetadata;
  persistenceMode: BatchManifest['persistenceMode']; keywords: string[];
}): BatchManifest {
  const initialPersistence = args.persistenceMode === 'local_only' ? 'not_requested' : 'pending';
  return {
    schemaVersion: '1',
    runId: args.runId,
    attemptId: args.attemptId,
    startedAt: args.startedAt,
    finishedAt: null,
    status: 'running',
    metadata: args.metadata,
    persistenceMode: args.persistenceMode,
    queries: args.keywords.map((keyword, inputIndex) => ({
      queryId: queryIdFor(inputIndex), inputIndex, keyword,
      status: 'pending', stopReason: null, selectedQueryAttemptId: null, attempts: [],
      resultFile: null, artifactIds: [], persistenceStatus: initialPersistence,
    })),
    artifacts: [],
  };
}

function updateRow(m: BatchManifest, queryId: string, fn: (row: QueryManifestEntry) => QueryManifestEntry): BatchManifest {
  const queries = m.queries.map((row) => (row.queryId === queryId ? fn(row) : row));
  return { ...m, queries };
}

export function markRunning(m: BatchManifest, queryId: string): BatchManifest {
  return updateRow(m, queryId, (row) => {
    if (row.status !== 'pending') return row;
    return { ...row, status: 'running' };
  });
}

export function selectAttempt(attempts: QueryAttemptSummary[]): QueryAttemptSummary {
  const first = attempts[0];
  if (!first) throw new Error('selectAttempt requires at least one attempt');
  return attempts.find((a) => a.status === 'captured')
    ?? attempts.find((a) => a.status === 'partial' || a.status === 'blocked')
    ?? first;
}

export function recordQueryAttempt(m: BatchManifest, queryId: string, summary: QueryAttemptSummary, artifacts: Artifact[]): BatchManifest {
  const persistenceStatus = m.persistenceMode === 'local_only' ? 'not_requested' : 'pending';
  const withArtifacts: BatchManifest = { ...m, artifacts: [...m.artifacts, ...artifacts] };
  return updateRow(withArtifacts, queryId, (row) => {
    const attempts: [QueryAttemptSummary, ...QueryAttemptSummary[]] = [...row.attempts, summary] as [QueryAttemptSummary, ...QueryAttemptSummary[]];
    const selected = selectAttempt(attempts);
    const identity = { queryId: row.queryId, inputIndex: row.inputIndex, keyword: row.keyword };
    const shared = {
      selectedQueryAttemptId: selected.queryAttemptId,
      attempts,
      resultFile: selected.resultFile,
      artifactIds: attempts.flatMap((a) => a.artifactIds),
      persistenceStatus,
    };
    switch (selected.status) {
      case 'captured': return { ...identity, ...shared, status: 'captured', stopReason: selected.stopReason, error: null };
      case 'partial': return { ...identity, ...shared, status: 'partial', stopReason: selected.stopReason, error: selected.error };
      case 'blocked': return { ...identity, ...shared, status: 'blocked', stopReason: selected.stopReason, error: selected.error };
      case 'failed': return { ...identity, ...shared, status: 'failed', stopReason: selected.stopReason, error: selected.error };
    }
  });
}

export function markSkipped(m: BatchManifest, queryId: string, reason: SkipReason): BatchManifest {
  return updateRow(m, queryId, (row) => ({
    queryId: row.queryId, inputIndex: row.inputIndex, keyword: row.keyword,
    status: 'skipped', stopReason: reason, selectedQueryAttemptId: null, attempts: [],
    resultFile: null, artifactIds: [], persistenceStatus: 'not_requested',
  }));
}

export function finalizeManifest(m: BatchManifest, finishedAt: string): BatchManifest {
  const statuses = m.queries.map((q) => q.status);
  const allCaptured = statuses.every((s) => s === 'captured');
  const anyEvidence = statuses.some((s) => s === 'captured' || s === 'partial' || s === 'blocked');
  const status: BatchManifest['status'] = allCaptured ? 'completed' : anyEvidence ? 'partial' : 'failed';
  return { ...m, finishedAt, status };
}

export function exitCodeFor(m: BatchManifest): 0 | 1 | 2 {
  if (m.status === 'completed') return 0;
  if (m.status === 'failed') return 1;
  return 2;
}
```

If the discriminated-union returns in `recordQueryAttempt` do not typecheck because `selected.stopReason` is too wide for a branch, narrow with `selected` itself (`if (selected.status === 'captured') return { ...identity, ...shared, ...selected }` picking `status`, `stopReason`, `error` from `selected`). Do not loosen the contracts.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/local-store.test.ts tests/manifest.test.ts && npm run typecheck`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/storage src/runner/manifest.ts tests/local-store.test.ts tests/manifest.test.ts
git commit -m "feat: add local artifact store and batch manifest bookkeeping"
```

---

### Task 11: Feed fixture, in-page reader, and Maps adapter

**Files:**
- Create: `tests/fixtures/feed-fixture.ts`, `src/browser/page-script.ts`, `src/browser/maps-adapter.ts`, `src/browser/launch.ts`, `tests/maps-adapter.test.ts`

**Interfaces:**
- Consumes: `FeedSnapshot`, `RawFeedChild`, `FeedLayout` from `src/core/types.ts`; `CaptureConfig` from `src/contracts.ts`.
- Produces (`tests/fixtures/feed-fixture.ts`):

```ts
export interface FixtureCard { name: string; ad?: boolean; placeId?: string; rating?: string; reviews?: number; category?: string; address?: string; tall?: boolean }
export interface FixtureOptions {
  title?: string;                 // document.title, default `${query} - Google Maps`
  query: string;                  // value of the search input
  cards: FixtureCard[];           // initially mounted cards
  moreCards?: FixtureCard[];      // appended when scrolled near the bottom (one batch)
  endOfList?: boolean;            // append the end marker after moreCards are exhausted
  noResults?: boolean;            // render the "can't find" page instead of a feed
  jitterMs?: number;              // if set, mutate the first card's text every N ms (instability)
}
export function buildFeedFixtureHtml(o: FixtureOptions): string
export async function writeFixture(o: FixtureOptions): Promise<string>  // writes to a temp file, returns file:// URL
```

The fixture page: a 1440x1000 body, a left pane `div[role="feed"]` at x=72, y=80, 408 wide, 875 tall, `overflow-y: auto`. Children: two header divs (first with height 0 and text `Rating Hours All filters`, second 48px `Results Share`), then for each card a `<div>` containing `<a href="https://www.google.com/maps/place/<name>/data=!4m7!3m6!1s<placeId>" aria-label="<name>">`, a `<span role="img" aria-label="<rating> stars">`, and text `<name> <rating> (<reviews>) <category> · <address> Closed · Opens 9 AM`; ad cards include `<div aria-label="Sponsored"><span>Sponsored</span></div>` inside the card; cards are 210px tall (`tall` makes 1200px); a 1px empty `<div>` separator follows every card; after the last card a 120px empty div and a 104px promo div. A search input `<input id="searchboxinput" value="<query>">` sits above the pane. A script listens for `scroll` on the feed: when `scrollTop + clientHeight >= scrollHeight - 300` and `moreCards` remain, it appends them (with separators, before the trailer) after 150 ms; when none remain and `endOfList` is true, it appends a div with text `You've reached the end of the list.` before the trailer once. When `jitterMs` is set, the first card's name gets an incrementing counter appended every `jitterMs` ms, so any two reads more than `jitterMs` apart differ.

- Produces (`src/browser/page-script.ts`): `readFeedSnapshotInPage(): FeedSnapshot | null` — a self-contained function (no closures over module scope) passed to `page.evaluate`.

- Produces (`src/browser/maps-adapter.ts`):

```ts
import type { Page } from 'playwright';
export type PageState =
  | { kind: 'results' } | { kind: 'captcha' } | { kind: 'consent' }
  | { kind: 'no_results' } | { kind: 'place_redirect' } | { kind: 'unknown'; detail: string };
export function buildSearchUrl(keyword: string, locale: string): string
export async function detectPageState(page: Page): Promise<PageState>
export async function openSearch(page: Page, url: string, timeoutMs: number): Promise<{ state: PageState; finalUrl: string }>
export async function readSnapshot(page: Page): Promise<FeedSnapshot | null>
export function queryMatches(snapshot: FeedSnapshot, keyword: string): boolean
export function nextScrollTop(snapshot: FeedSnapshot, layout: FeedLayout): number | null
export async function scrollFeedTo(page: Page, scrollTop: number): Promise<number>
export async function waitForFeedChange(page: Page, previous: { childCount: number; scrollHeight: number }, timeoutMs: number): Promise<'changed' | 'end' | 'unchanged'>
export const END_OF_LIST_TEXT = "You've reached the end of the list";
```

`buildSearchUrl('bubble tea garden city', 'en-US')` returns `https://www.google.com/maps/search/?api=1&query=bubble+tea+garden+city&hl=en`. `detectPageState`: pathname contains `/sorry/` or a frame whose URL contains `recaptcha` is `captcha`; hostname `consent.google.com` is `consent`; pathname starts with `/maps/place/` is `place_redirect`; a `div[role="feed"]` exists is `results`; body text contains `can't find` is `no_results`; else `unknown`. `openSearch` navigates with `waitUntil: 'domcontentloaded'`, then polls `detectPageState` every 250 ms until it is not `unknown` or `timeoutMs` elapses. `queryMatches` compares `observedQueryText` (trimmed, case-insensitive) to the keyword, or accepts a `pageTitle` that starts with the keyword. `nextScrollTop`: among layout cards, find the first card whose bottom exceeds the pane bottom (partially visible); if found, return `scrollTop + (card.bounds.y - pane.y)`; if none is partial and the last card's bottom is within the pane, return `scrollTop + (lastCard.bounds.y - pane.y)` (keep the last full card as overlap); if the last visible card is taller than the pane, return `scrollTop + pane.height`; return null when there are no cards. `scrollFeedTo` sets `feed.scrollTop` and returns the value the browser reports afterwards. `waitForFeedChange` polls every 100 ms and returns `end` as soon as the end marker is present, else `changed` on a child-count or scroll-height change, else `unchanged` at the timeout.

- Produces (`src/browser/launch.ts`):

```ts
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { CaptureConfig } from '../contracts.js';
export async function launchBrowser(): Promise<Browser>   // chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true })
export async function newSearchContext(browser: Browser, config: CaptureConfig): Promise<BrowserContext>
// viewport, locale, timezoneId from config; deviceScaleFactor 1; permissions: []; no storageState
```

- [ ] **Step 1: Write the fixture builder**

`tests/fixtures/feed-fixture.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface FixtureCard { name: string; ad?: boolean; placeId?: string; rating?: string; reviews?: number; category?: string; address?: string; tall?: boolean }
export interface FixtureOptions {
  title?: string; query: string; cards: FixtureCard[]; moreCards?: FixtureCard[];
  endOfList?: boolean; noResults?: boolean; jitterMs?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function cardHtml(c: FixtureCard, i: number): string {
  const placeId = c.placeId ?? `0x89c2000000000${i.toString(16)}:0x${(i + 1).toString(16).padStart(4, '0')}`;
  const rating = c.rating ?? '4.5';
  const reviews = c.reviews ?? 100 + i;
  const category = c.category ?? 'Bubble tea store';
  const address = c.address ?? `${100 + i} Main St`;
  const href = `https://www.google.com/maps/place/${encodeURIComponent(c.name)}/data=!4m7!3m6!1s${placeId}!8m2!3d40.7!4d-73.6`;
  const label = c.ad ? '<div aria-label="Sponsored" class="lbl"><span>Sponsored</span></div>' : '';
  return `<div class="card${c.tall ? ' tall' : ''}">
    <a href="${esc(href)}" aria-label="${esc(c.name)}"></a>
    ${label}
    <div class="name">${esc(c.name)}</div>
    <div><span role="img" aria-label="${rating} stars">${rating}</span> (${reviews.toLocaleString('en-US')})</div>
    <div>${esc(category)} · ${esc(address)}</div>
    <div>Closed · Opens 9 AM</div>
  </div>
  <div class="sep"></div>`;
}

export function buildFeedFixtureHtml(o: FixtureOptions): string {
  const title = o.title ?? `${o.query} - Google Maps`;
  if (o.noResults) {
    return `<!doctype html><html><head><title>${esc(title)}</title></head><body>
      <input id="searchboxinput" value="${esc(o.query)}">
      <div>Google Maps can't find ${esc(o.query)}</div></body></html>`;
  }
  const initial = o.cards.map(cardHtml).join('\n');
  const more = JSON.stringify((o.moreCards ?? []).map((c, i) => cardHtml(c, o.cards.length + i)));
  return `<!doctype html><html><head><title>${esc(title)}</title>
<style>
  body { margin: 0; width: 1440px; height: 1000px; font: 14px sans-serif; position: relative; }
  #searchboxinput { position: absolute; left: 88px; top: 16px; width: 360px; }
  #feed { position: absolute; left: 72px; top: 80px; width: 408px; height: 875px; overflow-y: auto; }
  .card { height: 210px; box-sizing: border-box; padding: 16px; }
  .card.tall { height: 1200px; }
  .sep { height: 1px; }
  .hdr0 { height: 0; overflow: hidden; } .hdr1 { height: 48px; }
  .trail0 { height: 120px; } .trail1 { height: 104px; }
  .lbl span { font-weight: bold; }
  #map { position: absolute; left: 480px; top: 0; width: 960px; height: 1000px; background: #dfe9d8; }
</style></head><body>
<input id="searchboxinput" value="${esc(o.query)}">
<div id="feed" role="feed">
  <div class="hdr0">Rating Hours All filters</div>
  <div class="hdr1">Results Share</div>
  ${initial}
  <div class="trail0"></div>
  <div class="trail1">You're seeing a limited view of Google Maps. Learn more</div>
</div>
<div id="map"></div>
<script>
  const feed = document.getElementById('feed');
  const more = ${more};
  const endOfList = ${o.endOfList ? 'true' : 'false'};
  let ended = false, pending = false;
  feed.addEventListener('scroll', () => {
    if (pending) return;
    if (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 300) return;
    const trailer = feed.querySelector('.trail0');
    if (more.length > 0) {
      pending = true;
      setTimeout(() => { trailer.insertAdjacentHTML('beforebegin', more.splice(0, more.length).join('')); pending = false; }, 150);
    } else if (endOfList && !ended) {
      ended = true;
      trailer.insertAdjacentHTML('beforebegin', '<div class="end">You\\'ve reached the end of the list.</div>');
    }
  });
  ${o.jitterMs ? `let jitter = 0; const nameEl = feed.querySelector('.card .name'); const baseName = nameEl ? nameEl.textContent : ''; setInterval(() => { if (nameEl) nameEl.textContent = baseName + ' ' + (++jitter); }, ${o.jitterMs});` : ''}
</script></body></html>`;
}

export async function writeFixture(o: FixtureOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mkc-fixture-'));
  const file = join(dir, 'feed.html');
  await writeFile(file, buildFeedFixtureHtml(o), 'utf8');
  return pathToFileURL(file).toString();
}

export function namedCards(count: number, startAt = 0): FixtureCard[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Shop ${String(startAt + i + 1).padStart(2, '0')}` }));
}
```

- [ ] **Step 2: Write the failing adapter tests**

`tests/maps-adapter.test.ts`:

```ts
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyFeedChildren } from '../src/core/feed-model.js';
import {
  END_OF_LIST_TEXT, buildSearchUrl, detectPageState, nextScrollTop, openSearch, queryMatches, readSnapshot, scrollFeedTo, waitForFeedChange,
} from '../src/browser/maps-adapter.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
});
afterAll(async () => { await browser.close(); });

describe('buildSearchUrl', () => {
  it('encodes the keyword without location parameters', () => {
    expect(buildSearchUrl('bubble tea garden city', 'en-US')).toBe('https://www.google.com/maps/search/?api=1&query=bubble+tea+garden+city&hl=en');
    expect(buildSearchUrl('café & "tea" / 奶茶', 'en-US')).toContain('query=caf%C3%A9+%26+%22tea%22+%2F+%E5%A5%B6%E8%8C%B6');
    expect(buildSearchUrl('x', 'en-US')).not.toMatch(/@|ll=|center=|near/);
  });
});

describe('page reading against the fixture', () => {
  it('detects results, reads the feed, and classifies its children', async () => {
    const url = await writeFixture({ query: 'bubble tea garden city', cards: [{ name: 'Gong Cha', ad: true }, ...namedCards(10)] });
    const opened = await openSearch(page, url, 5000);
    expect(opened.state).toEqual({ kind: 'results' });
    const snap = await readSnapshot(page);
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(snap.paneBounds).toMatchObject({ x: 72, y: 80, width: 408, height: 875 });
    expect(snap.observedQueryText).toBe('bubble tea garden city');
    expect(queryMatches(snap, 'bubble tea garden city')).toBe(true);
    expect(queryMatches(snap, 'matcha')).toBe(false);
    const layout = classifyFeedChildren(snap.children);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.layout.firstCardIndex).toBe(2);
    expect(layout.layout.stride).toBe(2);
    expect(layout.layout.cards).toHaveLength(11);
    const first = layout.layout.cards[0]!;
    expect(first.placeAriaLabel).toBe('Gong Cha');
    expect(first.sponsoredLabels).toEqual([{ text: 'Sponsored', ownerAriaLabel: 'Sponsored', depth: expect.any(Number) }]);
    expect(first.ratingAriaLabel).toBe('4.5 stars');
    expect(layout.layout.cards[1]!.sponsoredLabels).toEqual([]);
    expect(snap.endOfList).toBe(false);
  });

  it('computes the next scroll position from the first partially visible card', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(12) });
    await openSearch(page, url, 5000);
    const snap = (await readSnapshot(page))!;
    const layout = classifyFeedChildren(snap.children);
    if (!layout.ok) throw new Error(layout.detail);
    const target = nextScrollTop(snap, layout.layout)!;
    // Cards start at y=80+48 and are 211px apiece (210 + 1px separator). The 4th card (top 80+48+3*211=761, bottom 971) is cut by the pane bottom 955, so it moves to the top.
    expect(target).toBe(48 + 3 * 211);
    const applied = await scrollFeedTo(page, target);
    expect(applied).toBe(target);
    const after = (await readSnapshot(page))!;
    const layout2 = classifyFeedChildren(after.children);
    if (!layout2.ok) throw new Error(layout2.detail);
    expect(Math.round(layout2.layout.cards[3]!.bounds.y)).toBe(80);
  });

  it('loads more cards on scroll and then reports the end of the list', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(8), moreCards: namedCards(6, 8), endOfList: true });
    await openSearch(page, url, 5000);
    let snap = (await readSnapshot(page))!;
    expect(snap.children.filter((c) => c.placeHref).length).toBe(8);
    await scrollFeedTo(page, snap.scrollHeight);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 3000)).toBe('changed');
    snap = (await readSnapshot(page))!;
    expect(snap.children.filter((c) => c.placeHref).length).toBe(14);
    await scrollFeedTo(page, snap.scrollHeight);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 3000)).toBe('end');
    snap = (await readSnapshot(page))!;
    expect(snap.endOfList).toBe(true);
    expect(snap.children.some((c) => c.text.includes(END_OF_LIST_TEXT))).toBe(true);
    expect(await waitForFeedChange(page, { childCount: snap.children.length, scrollHeight: snap.scrollHeight }, 300)).toBe('end');
  });

  it('detects the no-results page', async () => {
    const url = await writeFixture({ query: 'zzz', cards: [], noResults: true });
    const opened = await openSearch(page, url, 3000);
    expect(opened.state).toEqual({ kind: 'no_results' });
    expect(await detectPageState(page)).toEqual({ kind: 'no_results' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/maps-adapter.test.ts`
Expected: FAIL, `../src/browser/maps-adapter.js` not found.

- [ ] **Step 4: Implement the page script**

`src/browser/page-script.ts`:

```ts
import type { FeedSnapshot } from '../core/types.js';

/**
 * Runs inside the page via page.evaluate. Must stay self-contained:
 * no imports used at runtime, no references to module-scope values.
 */
export function readFeedSnapshotInPage(): FeedSnapshot | null {
  const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
  if (!feed) return null;
  const pane = feed.getBoundingClientRect();
  const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const children = Array.from(feed.children).map((el, index) => {
    const r = el.getBoundingClientRect();
    const link = el.querySelector('a[href*="/maps/place/"]');
    const rating = el.querySelector('span[role="img"][aria-label$=" stars"], span[role="img"][aria-label$=" star"]');
    const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const sponsoredLabels: { text: string; ownerAriaLabel: string | null; depth: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;
    while (node) {
      if (node.children.length === 0 && (node.textContent || '').trim() === 'Sponsored') {
        let depth = 0;
        let p: Element | null = node;
        while (p && p !== el) { depth += 1; p = p.parentElement; }
        sponsoredLabels.push({ text: 'Sponsored', ownerAriaLabel: node.parentElement?.getAttribute('aria-label') ?? null, depth });
      }
      node = walker.nextNode() as Element | null;
    }
    return {
      index, tag: el.tagName, heightPx: Math.round(r.height), bounds: box(r),
      placeHref: link?.getAttribute('href') ?? null,
      placeAriaLabel: link?.getAttribute('aria-label') ?? null,
      ratingAriaLabel: rating?.getAttribute('aria-label') ?? null,
      text, sponsoredLabels,
    };
  });
  const feedText = feed.innerText || '';
  const input = document.querySelector('input#searchboxinput, input[aria-label*="Search" i]') as HTMLInputElement | null;
  return {
    children,
    paneBounds: box(pane),
    scrollTop: feed.scrollTop,
    scrollHeight: feed.scrollHeight,
    clientHeight: feed.clientHeight,
    endOfList: /reached the end of the list/i.test(feedText),
    observedQueryText: input ? input.value : null,
    pageTitle: document.title,
    url: location.href,
  };
}
```

- [ ] **Step 5: Implement the adapter and launcher**

`src/browser/maps-adapter.ts`:

```ts
import type { Page } from 'playwright';
import type { FeedLayout, FeedSnapshot } from '../core/types.js';
import { readFeedSnapshotInPage } from './page-script.js';

export const END_OF_LIST_TEXT = "You've reached the end of the list";

export type PageState =
  | { kind: 'results' } | { kind: 'captcha' } | { kind: 'consent' }
  | { kind: 'no_results' } | { kind: 'place_redirect' } | { kind: 'unknown'; detail: string };

export function buildSearchUrl(keyword: string, locale: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', keyword);
  url.searchParams.set('hl', locale.split('-')[0] ?? 'en');
  return url.toString();
}

export async function detectPageState(page: Page): Promise<PageState> {
  const url = new URL(page.url());
  if (url.pathname.includes('/sorry/')) return { kind: 'captcha' };
  if (page.frames().some((f) => /recaptcha/i.test(f.url()))) return { kind: 'captcha' };
  if (url.hostname === 'consent.google.com') return { kind: 'consent' };
  if (url.pathname.startsWith('/maps/place/')) return { kind: 'place_redirect' };
  const probe = await page.evaluate(() => ({
    feed: document.querySelector('div[role="feed"]') !== null,
    noResults: /can't find/i.test(document.body?.innerText ?? ''),
  })).catch(() => ({ feed: false, noResults: false }));
  if (probe.feed) return { kind: 'results' };
  if (probe.noResults) return { kind: 'no_results' };
  return { kind: 'unknown', detail: `no feed at ${page.url()}` };
}

export async function openSearch(page: Page, url: string, timeoutMs: number): Promise<{ state: PageState; finalUrl: string }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let state = await detectPageState(page);
  while (state.kind === 'unknown' && Date.now() < deadline) {
    await page.waitForTimeout(250);
    state = await detectPageState(page);
  }
  return { state, finalUrl: page.url() };
}

export async function readSnapshot(page: Page): Promise<FeedSnapshot | null> {
  return page.evaluate(readFeedSnapshotInPage);
}

export function queryMatches(snapshot: FeedSnapshot, keyword: string): boolean {
  const want = keyword.trim().toLowerCase();
  const seen = snapshot.observedQueryText?.trim().toLowerCase();
  if (seen === want) return true;
  return snapshot.pageTitle.trim().toLowerCase().startsWith(want);
}

export function nextScrollTop(snapshot: FeedSnapshot, layout: FeedLayout): number | null {
  const pane = snapshot.paneBounds;
  const paneBottom = pane.y + pane.height;
  const cards = layout.cards;
  const last = cards[cards.length - 1];
  if (!last) return null;
  const partial = cards.find((c) => c.bounds.y < paneBottom && c.bounds.y + c.bounds.height > paneBottom);
  if (partial) {
    if (partial.bounds.height > pane.height && partial.bounds.y <= pane.y + 0.5) {
      return snapshot.scrollTop + pane.height;      // oversized card: page through it
    }
    return snapshot.scrollTop + (partial.bounds.y - pane.y);
  }
  return snapshot.scrollTop + (last.bounds.y - pane.y); // keep the last full card as overlap
}

export async function scrollFeedTo(page: Page, scrollTop: number): Promise<number> {
  return page.evaluate((top) => {
    const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
    if (!feed) return -1;
    feed.scrollTop = top;
    return feed.scrollTop;
  }, scrollTop);
}

export async function waitForFeedChange(page: Page, previous: { childCount: number; scrollHeight: number }, timeoutMs: number): Promise<'changed' | 'end' | 'unchanged'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]') as HTMLElement | null;
      if (!feed) return null;
      return { childCount: feed.children.length, scrollHeight: feed.scrollHeight, end: /reached the end of the list/i.test(feed.innerText || '') };
    });
    if (probe) {
      if (probe.end) return 'end';
      if (probe.childCount !== previous.childCount || probe.scrollHeight !== previous.scrollHeight) return 'changed';
    }
    if (Date.now() >= deadline) return 'unchanged';
    await page.waitForTimeout(100);
  }
}
```

`src/browser/launch.ts`:

```ts
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { CaptureConfig } from '../contracts.js';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true });
}

export async function newSearchContext(browser: Browser, config: CaptureConfig): Promise<BrowserContext> {
  return browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
    locale: config.locale,
    timezoneId: config.browserTimezoneId,
    permissions: [],
    javaScriptEnabled: true,
  });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/maps-adapter.test.ts && npm run typecheck`
Expected: 5 passed. If the `nextScrollTop` arithmetic assertion is off by the header heights, print `snap.children.slice(0,4).map(c => [c.index, c.bounds.y, c.heightPx])` and correct the expected constant in the test to the fixture's real geometry; the rule under test is "first partially visible card moves to the pane top", verified by the `bounds.y === 80` assertion after scrolling.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/feed-fixture.ts src/browser tests/maps-adapter.test.ts
git commit -m "feat: add in-page feed reader, Maps adapter, and feed fixture"
```

---

### Task 12: Stable observation capture

**Files:**
- Create: `src/browser/stability.ts`, `tests/stability.test.ts`

**Interfaces:**
- Consumes: `readSnapshot` from `src/browser/maps-adapter.ts`; `FeedSnapshot` from `src/core/types.ts`; `sha256Hex` from `src/ids.ts`.
- Produces:

```ts
import type { Page } from 'playwright';
export function snapshotSignature(s: FeedSnapshot): string
export interface StableObservation {
  snapshot: FeedSnapshot;      // the snapshot taken immediately before the screenshot
  png: Buffer;                 // viewport screenshot
  preSignature: string;        // signature before the screenshot
  postSignature: string;       // signature after the screenshot
  accepted: boolean;           // pre === post and the settle check passed
  rejectionReason: string | null;
  attempts: number;
}
export async function captureStableObservation(page: Page, opts: { deadlineAt: number; settleMs?: number; maxAttempts?: number }): Promise<StableObservation | null>
```

Signature: `sha256Hex` of the JSON of `children.map(c => [c.index, c.placeHref, c.sponsoredLabels.length, Math.round(c.bounds.y), c.text])` plus `scrollTop`. Loop (default `settleMs` 500, `maxAttempts` 3): read `s1`; wait `settleMs`; read `s2`; if signatures differ, retry; take the screenshot; read `s3`; accept when `sig(s2) === sig(s3)`. Return `null` when the feed disappears. When attempts run out, return the last observation with `accepted: false` and `rejectionReason: 'unstable_results'`. Stop early with `rejectionReason: 'timeout'` when `Date.now() >= deadlineAt`.

- [ ] **Step 1: Write the failing tests**

`tests/stability.test.ts`:

```ts
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSearch } from '../src/browser/maps-adapter.js';
import { captureStableObservation, snapshotSignature } from '../src/browser/stability.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
});
afterAll(async () => { await browser.close(); });

describe('captureStableObservation', () => {
  it('accepts a stable page on the first attempt and returns a PNG', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6) }), 5000);
    const obs = await captureStableObservation(page, { deadlineAt: Date.now() + 10_000, settleMs: 200 });
    expect(obs).not.toBeNull();
    expect(obs!.accepted).toBe(true);
    expect(obs!.attempts).toBe(1);
    expect(obs!.preSignature).toBe(obs!.postSignature);
    expect(obs!.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(snapshotSignature(obs!.snapshot)).toBe(obs!.preSignature);
  });

  it('rejects a page whose feed keeps changing', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: namedCards(6), jitterMs: 120 }), 5000);
    const obs = await captureStableObservation(page, { deadlineAt: Date.now() + 10_000, settleMs: 300, maxAttempts: 3 });
    expect(obs!.accepted).toBe(false);
    expect(obs!.rejectionReason).toBe('unstable_results');
    expect(obs!.attempts).toBe(3);
  });

  it('returns null without a feed', async () => {
    await openSearch(page, await writeFixture({ query: 'q', cards: [], noResults: true }), 3000);
    expect(await captureStableObservation(page, { deadlineAt: Date.now() + 2000, settleMs: 100 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/stability.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/browser/stability.ts`:

```ts
import type { Page } from 'playwright';
import type { FeedSnapshot } from '../core/types.js';
import { sha256Hex } from '../ids.js';
import { readSnapshot } from './maps-adapter.js';

export function snapshotSignature(s: FeedSnapshot): string {
  const rows = s.children.map((c) => [c.index, c.placeHref, c.sponsoredLabels.length, Math.round(c.bounds.y), c.text]);
  return sha256Hex(JSON.stringify({ rows, scrollTop: Math.round(s.scrollTop) }));
}

export interface StableObservation {
  snapshot: FeedSnapshot;
  png: Buffer;
  preSignature: string;
  postSignature: string;
  accepted: boolean;
  rejectionReason: string | null;
  attempts: number;
}

export async function captureStableObservation(
  page: Page,
  opts: { deadlineAt: number; settleMs?: number; maxAttempts?: number },
): Promise<StableObservation | null> {
  const settleMs = opts.settleMs ?? 500;
  const maxAttempts = opts.maxAttempts ?? 3;
  let last: StableObservation | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() >= opts.deadlineAt) {
      return last ? { ...last, accepted: false, rejectionReason: 'timeout' } : null;
    }
    const s1 = await readSnapshot(page);
    if (!s1) return null;
    await page.waitForTimeout(settleMs);
    const s2 = await readSnapshot(page);
    if (!s2) return null;
    const pre = snapshotSignature(s2);
    if (snapshotSignature(s1) !== pre) {
      last = { snapshot: s2, png: Buffer.alloc(0), preSignature: pre, postSignature: pre, accepted: false, rejectionReason: 'unstable_results', attempts: attempt };
      continue;
    }
    const png = await page.screenshot({ type: 'png' });
    const s3 = await readSnapshot(page);
    if (!s3) return null;
    const post = snapshotSignature(s3);
    last = { snapshot: s2, png, preSignature: pre, postSignature: post, accepted: pre === post, rejectionReason: pre === post ? null : 'unstable_results', attempts: attempt };
    if (last.accepted) return last;
  }
  return last;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/stability.test.ts && npm run typecheck`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/browser/stability.ts tests/stability.test.ts
git commit -m "feat: capture screenshots only when the feed signature is stable"
```

---

### Task 13: Query attempt runner

**Files:**
- Create: `src/runner/query-runner.ts`, `tests/query-runner.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 12. Key names: `classifyFeedChildren`, `classifyCard`, `createReconcileState`, `applyRound`, `assignRanks`, `toListing`, `deriveOutcome`, `resultToCsv`, `captureStableObservation`, `openSearch`, `buildSearchUrl`, `queryMatches`, `nextScrollTop`, `scrollFeedTo`, `waitForFeedChange`, `newSearchContext`, `resultBaseName`, `screenshotFileName`, `queryAttemptRelativeDir`, `isoWithOffset`, `observationIdFor`, `ArtifactStore`.
- Produces:

```ts
import type { Browser } from 'playwright';
export class TransientBrowserError extends Error {}
export interface QueryRunnerDeps {
  browser: Browser;
  store: ArtifactStore;
  config: CaptureConfig;
  runId: string;
  attemptId: string;
  metadata: RunMetadata;
  attemptRelativeDir: string;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  /** Test hook: fixtures supply file:// URLs. Production leaves this undefined. */
  searchUrlFor?: (keyword: string) => string;
  /** Test hook: replace navigation and page-state detection. */
  openSearchImpl?: typeof openSearch;
}
export interface QueryAttemptInput {
  queryId: string; inputIndex: number; keyword: string; queryAttemptId: string;
  deadlineAt: number;                 // epoch ms; the attempt must finish before this
  allowTransientThrow: boolean;       // true: navigation/crash errors are thrown as TransientBrowserError for a retry
}
export interface QueryAttemptOutput {
  result: KeywordResult;
  summary: QueryAttemptSummary;
  artifacts: Artifact[];              // screenshots, observations.jsonl, result JSON, result CSV
  resultFile: string;                 // relative to the attempt root
}
export async function runQueryAttempt(deps: QueryRunnerDeps, input: QueryAttemptInput): Promise<QueryAttemptOutput>
```

Behavior (see design.md sections 5 to 10). Committed cards are the verified prefix; a card may be committed while still below the visible pane, and its screenshot coverage is filled in later rounds as the pane scrolls over it.

1. `startedAt = now()`. Create a context with `newSearchContext`, a page, and always close the context in `finally`.
2. Navigate with `openSearchImpl ?? openSearch` to `searchUrlFor?.(keyword) ?? buildSearchUrl(keyword, config.locale)` with timeout `min(30000, deadlineAt - now)`. A thrown navigation error becomes `TransientBrowserError` when `allowTransientThrow`, else a `failed / error` outcome.
3. Page states: `captcha` gives `blocked / captcha`; `consent` gives `blocked / consent_required`; `no_results` gives `complete / end_of_results` with zero listings; `place_redirect` and `unknown` give `incomplete / unsupported_layout` with a warning. Each of these saves one `diagnostic` screenshot named `<base>__diag.png`.
4. Results loop, with `state = createReconcileState()`, `scrolls = 0`, `stalls = 0`, `savedShots = 0`, `coverage = new Map<string, string[]>()` (occurrenceId to screenshot ids), `observations: Observation[] = []`, `screenshots: ScreenshotArtifact[] = []`:
   - `obs = captureStableObservation(page, { deadlineAt })`; `null` means the feed vanished: `incomplete / unsupported_layout`. Not accepted: `incomplete / unstable_results` (or `timeout` when that was the reason).
   - On the first round, if `!queryMatches(snapshot, keyword)`: `incomplete / query_mismatch`, `observedQueryText` recorded.
   - `layout = classifyFeedChildren(snapshot.children)`. `no_cards` on the first round: wait up to 3000 ms with `waitForFeedChange` and retry once; still none gives `complete / end_of_results` when `snapshot.endOfList`, else `incomplete / unsupported_layout`. `unsupported_layout` gives that incomplete reason.
   - `observationId = observationIdFor(queryAttemptId, observations.length + 1)`; `cards = layout.cards.map(c => classifyCard(c, snapshot.paneBounds, observationId))`; `before = state.committed.length`; `state = applyRound(state, { observationId, layout, cards }, limit)`.
   - Screenshot policy: save the PNG when this is the first round, or when at least one committed card is `fullyVisible` in this round and has no coverage yet; and only while fewer than `maxScreenshotsPerKeyword` results screenshots have been saved. Saving writes `<qdir>/<base>__NN.png` through the store, creates a `ScreenshotArtifact` (`id: \`${queryAttemptId}_shot${NN}\``, `kind: 'results'`, `observationId`, `width/height` from `config.viewport`, storage state from `store.persist`), and adds its id to `coverage` for every committed card that is `fullyVisible` in this round.
   - Push an `Observation` (`accepted`, `preSignature`, `postSignature`, `scrollOffset: snapshot.scrollTop`, `paneBounds`, `cards`, `screenshotIds`, `rejectionReason: null`).
   - `state.failure` gives `incomplete / <failure.reason>` and ends the loop.
   - Terminal check. `listComplete` is true when `state.committed.length >= limit` (reason `limit_reached`) or when `snapshot.endOfList` and every layout card index is already committed (reason `end_of_results`). `allCovered` is true when every committed card has at least one screenshot id in `coverage`. If `listComplete` and (`allCovered` or the screenshot budget is spent): `complete / <reason>` (an uncovered card then makes the outcome `partial / screenshot_limit`). If `listComplete` and the scroll budget is spent: `incomplete / scroll_limit`. Otherwise keep scrolling so the remaining committed cards become visible and get covered.
   - `scrolls >= maxScrollsPerKeyword`: `incomplete / scroll_limit`. `deadlineAt - now < 2000`: `incomplete / timeout`. Total bytes written for this attempt above 50 MiB (`ARTIFACT_BUDGET_BYTES`): `incomplete / artifact_limit`.
   - Scroll: `target = nextScrollTop(snapshot, layout)`; `applied = scrollFeedTo(page, target)`; `scrolls += 1`; if `applied <= snapshot.scrollTop` then `stalls += 1` else `stalls = 0`; `change = waitForFeedChange(page, { childCount, scrollHeight }, min(3000, remaining))`; if `change === 'unchanged'` and `applied <= snapshot.scrollTop` and `stalls >= 3`: `incomplete / load_stalled`.
5. Finish: `{ ranked, classificationComplete } = assignRanks(state.committed)`; `screenshotCoverageComplete = ranked.every(r => (coverage.get(r.committed.card.occurrenceId) ?? []).length > 0)`; `listings = ranked.map(r => toListing(r, coverage.get(...) ?? []))`; `outcome = deriveOutcome({ stop, sequenceVerified: state.failure === null, classificationComplete, screenshotCoverageComplete, listingCount: listings.length })`.
6. Write `observations.jsonl` (one `Observation` per line), then the result JSON (`<base>.json`), then the CSV (`<base>.csv`), each through the store, each producing an `Artifact` with kind `observations_jsonl`, `result_json`, `result_csv`. The result JSON includes `screenshots` and `observationArtifactIds: [obsArtifact.id]` but not its own artifact. `context.observedMapView` is parsed from `finalUrl` with `/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/` or null. `quality.warnings` collects layout and state notes with `observationIds`.
7. `summary` copies `status`, `stopReason`, `error`, `queryAttemptId`, `startedAt`, `finishedAt`, `resultFile`, `artifactIds` (all artifact ids including the result JSON and CSV).
8. Log one JSON event per stage through `deps.log` when provided: `navigate`, `ready`, `round` (with `observationId`, `committed`, `saved`), `stop`, `export`, each with `elapsedMs`.

- [ ] **Step 1: Write the failing test**

`tests/query-runner.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KeywordResult, RunMetadata } from '../src/contracts.js';
import { runQueryAttempt } from '../src/runner/query-runner.js';
import { LocalArtifactStore } from '../src/storage/local.js';
import { parseConfig } from '../src/config.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let browser: Browser;
let root: string;
const metadata: RunMetadata = { configHash: 'c', profileHash: 'p', adapterVersion: 'maps-feed-card/v1', sourceCommit: null, browserVersion: null, imageDigest: null, egressProfileId: null };

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  root = await mkdtemp(join(tmpdir(), 'mkc-run-'));
});
afterAll(async () => { await browser.close(); await rm(root, { recursive: true, force: true }); });

function deps(url: string, over: Record<string, unknown> = {}) {
  const { config } = parseConfig({ schemaVersion: '1', keywords: ['bubble tea garden city'], outputDirectory: root, ...over });
  return {
    browser, store: new LocalArtifactStore(root), config, runId: 'run_t', attemptId: 'att_t', metadata,
    attemptRelativeDir: 'maps-keyword-capture/2026-09-17/run_t/att_t',
    searchUrlFor: () => url,
  };
}
const input = (over: Record<string, unknown> = {}) => ({
  queryId: 'q0001', inputIndex: 0, keyword: 'bubble tea garden city', queryAttemptId: 'qa01',
  deadlineAt: Date.now() + 60_000, allowTransientThrow: false, ...over,
});

describe('runQueryAttempt', () => {
  it('captures 15 listings with an ad at position 1, screenshots, observations, JSON, and CSV', async () => {
    const url = await writeFixture({
      query: 'bubble tea garden city',
      cards: [{ name: 'Gong Cha', ad: true, placeId: '0xg:0xc' }, ...namedCards(9)],
      moreCards: [...namedCards(9, 9), { name: 'Gong Cha', placeId: '0xg:0xc' }],
      endOfList: true,
    });
    const out = await runQueryAttempt(deps(url), input());
    const r: KeywordResult = out.result;
    expect(r.status).toBe('captured');
    expect(r.stopReason).toBe('limit_reached');
    expect(r.observedCount).toBe(15);
    expect(r.sequenceVerified).toBe(true);
    expect(r.listings[0]).toMatchObject({ displayPosition: 1, resultType: 'ad', adLabel: 'Sponsored', organicRank: null, name: 'Gong Cha' });
    expect(r.listings[1]).toMatchObject({ displayPosition: 2, resultType: 'organic', organicRank: 1, name: 'Shop 01' });
    expect(r.listings[14]).toMatchObject({ displayPosition: 15, organicRank: 14 });
    expect(r.listings.every((l) => l.screenshotIds.length > 0)).toBe(true);
    expect(r.quality.screenshotCoverageComplete).toBe(true);
    expect(r.screenshots.length).toBeGreaterThanOrEqual(3);
    expect(r.screenshots.length).toBeLessThanOrEqual(5);
    expect(r.context).toMatchObject({ locationMode: 'query_only', configuredMapView: null, loggedIn: false, geolocationPermission: 'not_granted' });
    expect(out.summary).toMatchObject({ status: 'captured', queryAttemptId: 'qa01', resultFile: expect.stringMatching(/^q0001\/qa01\/.+__bubble-tea-garden-city__q0001\.json$/) });
    const kinds = out.artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(['results', 'observations_jsonl', 'result_json', 'result_csv']));
    for (const a of out.artifacts) {
      const s = await stat(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', a.queryId!, a.queryAttemptId!, a.filename));
      expect(s.size).toBe(a.bytes);
    }
    const csv = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t', out.resultFile.replace(/\.json$/, '.csv')), 'utf8');
    expect(csv.split('\r\n')).toHaveLength(17);
    const jsonl = await readFile(join(root, 'maps-keyword-capture/2026-09-17/run_t/att_t/q0001/qa01/observations.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n').length).toBeGreaterThanOrEqual(r.screenshots.length);
    expect(JSON.parse(jsonl.trim().split('\n')[0]!)).toMatchObject({ observationId: 'qa01_obs001', accepted: true, queryAttemptId: 'qa01' });
  });

  it('reports end_of_results as captured when fewer than the limit exist', async () => {
    const url = await writeFixture({ query: 'fried chicken mineola', cards: namedCards(7), endOfList: true });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0002', keyword: 'fried chicken mineola' }));
    expect(out.result).toMatchObject({ status: 'captured', stopReason: 'end_of_results', observedCount: 7 });
  });

  it('stops with scroll_limit as partial when the budget runs out', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(6), moreCards: namedCards(20, 6) });
    const out = await runQueryAttempt(deps(url, { maxScrollsPerKeyword: 1 }), input({ queryId: 'q0003', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('scroll_limit');
    expect(out.result.observedCount).toBeGreaterThan(0);
  });

  it('records a query mismatch instead of guessing', async () => {
    const url = await writeFixture({ query: 'something else', title: 'something else - Google Maps', cards: namedCards(5) });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0004', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'partial', stopReason: 'query_mismatch', observedCount: 0 });
    expect(out.result.quality.observedQueryText).toBe('something else');
  });

  it('treats a no-results page as captured with zero listings and a diagnostic screenshot', async () => {
    const url = await writeFixture({ query: 'zzz', cards: [], noResults: true });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0005', keyword: 'zzz' }));
    expect(out.result).toMatchObject({ status: 'captured', stopReason: 'end_of_results', observedCount: 0 });
    expect(out.result.screenshots.map((s) => s.kind)).toEqual(['diagnostic']);
  });

  it('marks unstable feeds as partial / unstable_results', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), jitterMs: 120 });
    const out = await runQueryAttempt(deps(url), input({ queryId: 'q0006', keyword: 'q' }));
    expect(out.result.status).toBe('partial');
    expect(out.result.stopReason).toBe('unstable_results');
  });

  it('turns a blocked page state into blocked / captcha', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const d = { ...deps(url), openSearchImpl: async () => ({ state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/index' }) };
    const out = await runQueryAttempt(d, input({ queryId: 'q0007', keyword: 'q' }));
    expect(out.result).toMatchObject({ status: 'blocked', stopReason: 'captcha', finalUrl: 'https://www.google.com/sorry/index' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query-runner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/runner/query-runner.ts`:

```ts
import type { Browser, Page } from 'playwright';
import type {
  Artifact, CaptureConfig, CaptureError, KeywordResult, Observation, QueryAttemptSummary, QueryQuality, RunMetadata, ScreenshotArtifact,
} from '../contracts.js';
import { classifyCard } from '../core/classify.js';
import { classifyFeedChildren } from '../core/feed-model.js';
import { deriveOutcome, type StopCause } from '../core/outcome.js';
import { assignRanks, toListing } from '../core/ranking.js';
import { applyRound, createReconcileState, type ReconcileState } from '../core/reconcile.js';
import type { ClassifiedCard, FeedSnapshot } from '../core/types.js';
import { resultToCsv } from '../export/csv.js';
import { observationIdFor } from '../ids.js';
import { isoWithOffset, queryAttemptRelativeDir, resultBaseName, screenshotFileName } from '../naming.js';
import { newSearchContext } from '../browser/launch.js';
import {
  buildSearchUrl, nextScrollTop, openSearch, queryMatches, scrollFeedTo, waitForFeedChange,
} from '../browser/maps-adapter.js';
import { captureStableObservation } from '../browser/stability.js';
import type { ArtifactStore } from '../storage/types.js';

export const ARTIFACT_BUDGET_BYTES = 50 * 1024 * 1024;

export class TransientBrowserError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'TransientBrowserError'; }
}

export interface QueryRunnerDeps {
  browser: Browser;
  store: ArtifactStore;
  config: CaptureConfig;
  runId: string;
  attemptId: string;
  metadata: RunMetadata;
  attemptRelativeDir: string;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: typeof openSearch;
}

export interface QueryAttemptInput {
  queryId: string; inputIndex: number; keyword: string; queryAttemptId: string;
  deadlineAt: number; allowTransientThrow: boolean;
}

export interface QueryAttemptOutput {
  result: KeywordResult; summary: QueryAttemptSummary; artifacts: Artifact[]; resultFile: string;
}

type Warning = QueryQuality['warnings'][number];

function parseObservedMapView(url: string | null): KeywordResult['context']['observedMapView'] {
  if (!url) return null;
  const m = /@(-?\d+\.\d+),(-?\d+\.\d+)(?:,(\d+(?:\.\d+)?)z)?/.exec(url);
  if (!m) return null;
  return { latitude: Number(m[1]), longitude: Number(m[2]), zoom: m[3] ? Number(m[3]) : null };
}

function errorOf(err: unknown, code: string): CaptureError {
  return { code, message: err instanceof Error ? err.message : String(err) };
}

export async function runQueryAttempt(deps: QueryRunnerDeps, input: QueryAttemptInput): Promise<QueryAttemptOutput> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const { config, store } = deps;
  const startedAtDate = now();
  const startedMs = startedAtDate.getTime();
  const tz = config.filenameTimezone;
  const base = resultBaseName(startedAtDate, tz, input.keyword, input.queryId);
  const qdir = queryAttemptRelativeDir(input.queryId, input.queryAttemptId);
  const rel = (name: string) => `${deps.attemptRelativeDir}/${qdir}/${name}`;
  const limit = config.maxResultsPerKeyword;
  const remaining = () => input.deadlineAt - Date.now();
  const stage = (name: string, extra: Record<string, unknown> = {}) =>
    log({ stage: name, runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId, elapsedMs: Date.now() - startedMs, ...extra });

  const screenshots: ScreenshotArtifact[] = [];
  const observations: Observation[] = [];
  const artifacts: Artifact[] = [];
  const warnings: Warning[] = [];
  const coverage = new Map<string, string[]>();
  let bytesWritten = 0;
  let state: ReconcileState = createReconcileState();
  let stop: StopCause | null = null;
  let finalUrl: string | null = null;
  let observedQueryText: string | null = null;

  async function saveScreenshot(png: Buffer, kind: 'results' | 'diagnostic', observationId: string | null): Promise<ScreenshotArtifact> {
    const n = screenshots.filter((s) => s.kind === 'results').length + 1;
    const filename = kind === 'results' ? screenshotFileName(base, n) : `${base}__diag.png`;
    const written = await store.writeFile(rel(filename), png);
    bytesWritten += written.bytes;
    const storage = await store.persist(written);
    const shot: ScreenshotArtifact = {
      ...storage,
      id: kind === 'results' ? `${input.queryAttemptId}_shot${String(n).padStart(2, '0')}` : `${input.queryAttemptId}_diag`,
      filename, kind, bytes: written.bytes, sha256: written.sha256,
      queryId: input.queryId, queryAttemptId: input.queryAttemptId,
      capturedAt: isoWithOffset(now(), tz), width: config.viewport.width, height: config.viewport.height, observationId,
    };
    screenshots.push(shot);
    artifacts.push(shot);
    return shot;
  }

  const context = await newSearchContext(deps.browser, config);
  try {
    const page: Page = await context.newPage();
    const url = deps.searchUrlFor?.(input.keyword) ?? buildSearchUrl(input.keyword, config.locale);
    const open = deps.openSearchImpl ?? openSearch;
    let opened: Awaited<ReturnType<typeof openSearch>>;
    try {
      opened = await open(page, url, Math.max(1000, Math.min(30_000, remaining())));
    } catch (err) {
      if (input.allowTransientThrow) throw new TransientBrowserError(`navigation failed for ${input.queryId}`, err);
      stop = { kind: 'failed', reason: 'error', error: errorOf(err, 'navigation_failed') };
      opened = { state: { kind: 'unknown', detail: 'navigation failed' }, finalUrl: page.url() };
    }
    finalUrl = opened.finalUrl;
    stage('navigate', { state: opened.state.kind, finalUrl });

    if (!stop) {
      switch (opened.state.kind) {
        case 'captcha': stop = { kind: 'blocked', reason: 'captcha', error: null }; break;
        case 'consent': stop = { kind: 'blocked', reason: 'consent_required', error: null }; break;
        case 'no_results': stop = { kind: 'complete', reason: 'end_of_results' }; break;
        case 'place_redirect':
          stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
          warnings.push({ code: 'place_redirect', message: 'Google opened a place page instead of a results list', observationIds: [] });
          break;
        case 'unknown':
          stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
          warnings.push({ code: 'unknown_page', message: opened.state.detail, observationIds: [] });
          break;
        case 'results': break;
      }
      if (stop) {
        const png = await page.screenshot({ type: 'png' }).catch(() => null);
        if (png) await saveScreenshot(png, 'diagnostic', null);
      }
    }

    let scrolls = 0;
    let stalls = 0;
    let waitedForCards = false;
    while (!stop) {
      const obs = await captureStableObservation(page, { deadlineAt: input.deadlineAt });
      if (!obs) { stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null }; warnings.push({ code: 'feed_vanished', message: 'results feed disappeared', observationIds: [] }); break; }
      if (!obs.accepted) { stop = { kind: 'incomplete', reason: obs.rejectionReason === 'timeout' ? 'timeout' : 'unstable_results', error: null }; break; }
      const snapshot: FeedSnapshot = obs.snapshot;
      if (observations.length === 0) {
        observedQueryText = snapshot.observedQueryText;
        stage('ready');
        if (!queryMatches(snapshot, input.keyword)) { stop = { kind: 'incomplete', reason: 'query_mismatch', error: null }; break; }
      }
      const layoutResult = classifyFeedChildren(snapshot.children);
      if (!layoutResult.ok) {
        if (layoutResult.reason === 'no_cards' && !waitedForCards) {
          waitedForCards = true;
          await waitForFeedChange(page, { childCount: snapshot.children.length, scrollHeight: snapshot.scrollHeight }, Math.max(0, Math.min(3000, remaining())));
          continue;
        }
        if (layoutResult.reason === 'no_cards' && snapshot.endOfList) { stop = { kind: 'complete', reason: 'end_of_results' }; break; }
        stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null };
        warnings.push({ code: layoutResult.reason, message: layoutResult.detail, observationIds: [] });
        break;
      }
      const layout = layoutResult.layout;
      const observationId = observationIdFor(input.queryAttemptId, observations.length + 1);
      const cards: ClassifiedCard[] = layout.cards.map((c) => classifyCard(c, snapshot.paneBounds, observationId));
      const before = state.committed.length;
      state = applyRound(state, { observationId, layout, cards }, limit);

      const committedIds = new Set(state.committed.map((e) => e.card.occurrenceId));
      const visibleCommitted = cards.filter((c) => c.fullyVisible && committedIds.has(c.occurrenceId));
      const shouldSave = observations.length === 0 || visibleCommitted.some((c) => !coverage.has(c.occurrenceId));
      const resultsSaved = () => screenshots.filter((s) => s.kind === 'results').length;
      const screenshotIds: string[] = [];
      if (shouldSave && resultsSaved() < config.maxScreenshotsPerKeyword) {
        const shot = await saveScreenshot(obs.png, 'results', observationId);
        screenshotIds.push(shot.id);
        for (const c of visibleCommitted) coverage.set(c.occurrenceId, [...(coverage.get(c.occurrenceId) ?? []), shot.id]);
      }
      observations.push({
        observationId, runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId,
        observedAt: isoWithOffset(now(), tz), scrollOffset: snapshot.scrollTop, paneBounds: snapshot.paneBounds,
        preSignature: obs.preSignature, postSignature: obs.postSignature, accepted: true, rejectionReason: null,
        cards, screenshotIds,
      });
      stage('round', { observationId, committed: state.committed.length, newlyCommitted: state.committed.length - before, saved: screenshotIds.length });

      if (state.failure) {
        stop = { kind: 'incomplete', reason: state.failure.reason, error: null };
        warnings.push({ code: state.failure.reason, message: state.failure.detail, observationIds: [observationId] });
        break;
      }
      const committedIndices = new Set(state.committed.map((e) => e.card.feedChildIndex));
      const completeReason: 'limit_reached' | 'end_of_results' | null =
        state.committed.length >= limit ? 'limit_reached'
          : snapshot.endOfList && layout.cards.every((c) => committedIndices.has(c.index)) ? 'end_of_results'
            : null;
      const allCovered = state.committed.every((e) => coverage.has(e.card.occurrenceId));
      if (completeReason) {
        if (allCovered || resultsSaved() >= config.maxScreenshotsPerKeyword) { stop = { kind: 'complete', reason: completeReason }; break; }
        if (scrolls >= config.maxScrollsPerKeyword) { stop = { kind: 'incomplete', reason: 'scroll_limit', error: null }; break; }
        // Otherwise keep scrolling so the remaining committed cards get screenshot coverage.
      }
      if (scrolls >= config.maxScrollsPerKeyword) { stop = { kind: 'incomplete', reason: 'scroll_limit', error: null }; break; }
      if (remaining() < 2000) { stop = { kind: 'incomplete', reason: 'timeout', error: null }; break; }
      if (bytesWritten > ARTIFACT_BUDGET_BYTES) { stop = { kind: 'incomplete', reason: 'artifact_limit', error: null }; break; }

      const target = nextScrollTop(snapshot, layout);
      if (target === null) { stop = { kind: 'incomplete', reason: 'unsupported_layout', error: null }; break; }
      const applied = await scrollFeedTo(page, target);
      scrolls += 1;
      stalls = applied <= snapshot.scrollTop ? stalls + 1 : 0;
      const change = await waitForFeedChange(page, { childCount: snapshot.children.length, scrollHeight: snapshot.scrollHeight }, Math.max(0, Math.min(3000, remaining())));
      if (change === 'unchanged' && stalls >= 3) { stop = { kind: 'incomplete', reason: 'load_stalled', error: null }; break; }
    }
  } catch (err) {
    if (err instanceof TransientBrowserError) throw err;
    if (input.allowTransientThrow && observations.length === 0 && /Target (page|context|browser) has been closed|crashed/i.test(String(err))) {
      throw new TransientBrowserError('browser context failed before any evidence', err);
    }
    stop = { kind: observations.length === 0 ? 'failed' : 'incomplete', reason: 'error', error: errorOf(err, 'unexpected_error') } as StopCause;
  } finally {
    await context.close().catch(() => undefined);
  }

  const { ranked, classificationComplete } = assignRanks(state.committed);
  const screenshotCoverageComplete = ranked.every((r) => (coverage.get(r.committed.card.occurrenceId) ?? []).length > 0);
  const listings = ranked.map((r) => toListing(r, coverage.get(r.committed.card.occurrenceId) ?? []));
  const outcome = deriveOutcome({
    stop: stop ?? { kind: 'failed', reason: 'error', error: { code: 'no_stop', message: 'attempt ended without a stop cause' } },
    sequenceVerified: state.failure === null,
    classificationComplete, screenshotCoverageComplete, listingCount: listings.length,
  });
  stage('stop', { status: outcome.status, stopReason: outcome.stopReason, listings: listings.length });

  const obsWritten = await store.writeFile(rel('observations.jsonl'), observations.map((o) => JSON.stringify(o)).join('\n') + (observations.length ? '\n' : ''));
  const obsArtifact: Artifact = { ...(await store.persist(obsWritten)), id: `${input.queryAttemptId}_observations`, filename: 'observations.jsonl', kind: 'observations_jsonl', bytes: obsWritten.bytes, sha256: obsWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId };
  artifacts.push(obsArtifact);

  const finishedAt = isoWithOffset(now(), tz);
  const result: KeywordResult = {
    ...outcome,
    schemaVersion: '1',
    runId: deps.runId, attemptId: deps.attemptId, queryId: input.queryId, queryAttemptId: input.queryAttemptId,
    keyword: input.keyword,
    startedAt: isoWithOffset(startedAtDate, tz), finishedAt,
    requestedLimit: limit, observedCount: listings.length, sequenceVerified: state.failure === null, finalUrl,
    metadata: deps.metadata,
    context: {
      locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1,
      locationMode: 'query_only', configuredMapView: null, observedMapView: parseObservedMapView(finalUrl),
      loggedIn: false, geolocationPermission: 'not_granted', egressRegion: null, egressSource: null, observedLocationText: null, filters: [],
    },
    quality: { verifiedPrefixLength: state.committed.length, classificationComplete, screenshotCoverageComplete, warnings, observedQueryText, queryCorrectionText: null },
    listings, screenshots, observationArtifactIds: [obsArtifact.id],
  };

  const jsonName = `${base}.json`;
  const jsonWritten = await store.writeFile(rel(jsonName), JSON.stringify(result, null, 2));
  artifacts.push({ ...(await store.persist(jsonWritten)), id: `${input.queryAttemptId}_result_json`, filename: jsonName, kind: 'result_json', bytes: jsonWritten.bytes, sha256: jsonWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId });
  const csvName = `${base}.csv`;
  const csvWritten = await store.writeFile(rel(csvName), resultToCsv(result));
  artifacts.push({ ...(await store.persist(csvWritten)), id: `${input.queryAttemptId}_result_csv`, filename: csvName, kind: 'result_csv', bytes: csvWritten.bytes, sha256: csvWritten.sha256, queryId: input.queryId, queryAttemptId: input.queryAttemptId });
  stage('export', { artifacts: artifacts.length });

  const resultFile = `${qdir}/${jsonName}`;
  const summary: QueryAttemptSummary = {
    ...outcome,
    queryAttemptId: input.queryAttemptId, startedAt: result.startedAt, finishedAt, resultFile,
    artifactIds: artifacts.map((a) => a.id),
  };
  return { result, summary, artifacts, resultFile };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/query-runner.test.ts && npm run typecheck`
Expected: 7 passed. If the first test fails on the screenshot count, print `r.screenshots.map(s => s.observationId)` and `r.listings.map(l => [l.displayPosition, l.screenshotIds])`: every saved screenshot must add coverage for at least one previously uncovered committed card, and the loop must stop as soon as all 15 are covered. Fix the loop, not the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/runner/query-runner.ts tests/query-runner.test.ts
git commit -m "feat: run one query attempt end to end with evidence and exports"
```

---

### Task 14: Batch runner and CLI

**Files:**
- Create: `src/runner/batch-runner.ts`, `src/cli.ts`, `tests/batch-runner.test.ts`
- Modify: `README.md` (replace the "Development setup" and "Next steps" sections as shown below)

**Interfaces:**
- Consumes: `runQueryAttempt`, `TransientBrowserError`, `QueryRunnerDeps` (Task 13); manifest functions (Task 10); `LocalArtifactStore`; `launchBrowser`; `hashJson`, `newRunId`, `newAttemptId`, `queryIdFor`, `queryAttemptIdFor`; `attemptRelativeDir`, `isoWithOffset`; `loadConfigFile`, `ConfigError`.
- Produces:

```ts
// batch-runner.ts
export interface BatchDeps {
  config: CaptureConfig;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  launch?: () => Promise<Browser>;                 // default launchBrowser
  searchUrlFor?: (keyword: string) => string;      // test hook, passed through
  openSearchImpl?: QueryRunnerDeps['openSearchImpl'];
  signal?: AbortSignal;                            // SIGTERM / cancellation
}
export interface BatchOutput { manifest: BatchManifest; attemptRoot: string; manifestPath: string; exitCode: 0 | 1 | 2 }
export const ADAPTER_VERSION = 'maps-feed-card/v1';
export function batchDeadlineMs(config: CaptureConfig): number   // (60 + N * (keywordTimeoutMs/1000 + 30) + 60) * 1000
export async function runBatch(deps: BatchDeps): Promise<BatchOutput>

// cli.ts: `tsx src/cli.ts --config <path>`; exit 64 on ConfigError, 1 on unexpected error, else exitCodeFor(manifest)
```

Behavior: `runId`, `attemptId`, `startedAt`. `metadata = { configHash: hashJson(config), profileHash: hashJson({ surface: 'google-maps-desktop', locale, browserTimezoneId, viewport, deviceScaleFactor: 1, locationMode: 'query_only', adapterVersion }), adapterVersion, sourceCommit: process.env.GIT_COMMIT ?? null, browserVersion (filled after launch), imageDigest: process.env.IMAGE_DIGEST ?? null, egressProfileId: process.env.EGRESS_PROFILE_ID ?? null }`. Store root is `config.outputDirectory`; attempt dir from `attemptRelativeDir`. Write `request.json` (`{ runId, attemptId, startedAt, config }`), then the manifest to `manifest.progress.json`. Launch the browser; on failure mark every row `skipped / browser_startup_failed`, finalize, write `manifest.json`, return exit 1. For each keyword in order: if `signal.aborted` mark `skipped / cancelled`; else if the circuit breaker is set mark `skipped / batch_blocked`; else if `Date.now() > batchDeadlineAt` mark `skipped / batch_timeout`; else `markRunning`, then run attempt `qa01` with `deadlineAt = min(now + keywordTimeoutMs, batchDeadlineAt)` and `allowTransientThrow = (keywordDeadline - now) > 15000`; on `TransientBrowserError` run `qa02` with the same keyword deadline and `allowTransientThrow = false`. `recordQueryAttempt` for every attempt; trip the breaker when the selected status is `blocked` with `captcha`. After each keyword rewrite `manifest.progress.json`. After the loop, `finalizeManifest`, write `manifest.json`, close the browser, return. Register `SIGTERM` and `SIGINT` in `cli.ts` to abort an `AbortController` passed as `signal`.

- [ ] **Step 1: Write the failing test**

`tests/batch-runner.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import type { BatchManifest } from '../src/contracts.js';
import { batchDeadlineMs, runBatch } from '../src/runner/batch-runner.js';
import { namedCards, writeFixture } from './fixtures/feed-fixture.js';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'mkc-batch-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('runBatch', () => {
  it('computes the batch deadline from the keyword count', () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], keywordTimeoutMs: 90_000, outputDirectory: root });
    expect(batchDeadlineMs(config)).toBe((60 + 2 * (90 + 30) + 60) * 1000);
  });

  it('runs every keyword, writes manifests, and exits 0 when all are captured', async () => {
    const urls: Record<string, string> = {
      'fried chicken mineola': await writeFixture({ query: 'fried chicken mineola', cards: namedCards(8), endOfList: true }),
      'matcha mineola': await writeFixture({ query: 'matcha mineola', cards: [{ name: 'Gong Cha', ad: true }, ...namedCards(16)] }),
    };
    const { config } = parseConfig({ schemaVersion: '1', keywords: Object.keys(urls), outputDirectory: root, maxScrollsPerKeyword: 6 });
    const out = await runBatch({ config, searchUrlFor: (k) => urls[k]! });
    expect(out.exitCode).toBe(0);
    expect(out.manifest.status).toBe('completed');
    expect(out.manifest.persistenceMode).toBe('local_only');
    expect(out.manifest.queries.map((q) => [q.queryId, q.status, q.persistenceStatus])).toEqual([['q0001', 'captured', 'not_requested'], ['q0002', 'captured', 'not_requested']]);
    const onDisk = JSON.parse(await readFile(out.manifestPath, 'utf8')) as BatchManifest;
    expect(onDisk.status).toBe('completed');
    expect(onDisk.artifacts.length).toBeGreaterThan(6);
    expect(onDisk.artifacts.every((a) => a.storageStatus === 'local_only')).toBe(true);
    const request = JSON.parse(await readFile(join(out.attemptRoot, 'request.json'), 'utf8'));
    expect(request.config.keywords).toEqual(Object.keys(urls));
    expect(out.manifest.metadata.browserVersion).toMatch(/^\d+\./);
  });

  it('trips the circuit breaker on CAPTCHA and skips the rest', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5) });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two', 'three'], outputDirectory: root });
    let calls = 0;
    const out = await runBatch({
      config, searchUrlFor: () => url,
      openSearchImpl: async () => { calls += 1; return { state: { kind: 'captcha' as const }, finalUrl: 'https://www.google.com/sorry/x' }; },
    });
    expect(calls).toBe(1);
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['blocked', 'captcha'], ['skipped', 'batch_blocked'], ['skipped', 'batch_blocked']]);
    expect(out.manifest.status).toBe('partial');
    expect(out.exitCode).toBe(2);
  });

  it('marks all keywords skipped when the browser cannot start', async () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['one', 'two'], outputDirectory: root });
    const out = await runBatch({ config, launch: async () => { throw new Error('no chromium'); } });
    expect(out.manifest.queries.map((q) => [q.status, q.stopReason])).toEqual([['skipped', 'browser_startup_failed'], ['skipped', 'browser_startup_failed']]);
    expect(out.manifest.status).toBe('failed');
    expect(out.exitCode).toBe(1);
  });

  it('skips remaining keywords after cancellation', async () => {
    const url = await writeFixture({ query: 'q', cards: namedCards(5), endOfList: true });
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a', 'b'], outputDirectory: root });
    const controller = new AbortController();
    const out = await runBatch({
      config, searchUrlFor: () => url, signal: controller.signal,
      log: (e) => { if (e['stage'] === 'query_done') controller.abort(); },
    });
    expect(out.manifest.queries.map((q) => q.status)).toEqual(['captured', 'skipped']);
    expect(out.manifest.queries[1]!.stopReason).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/batch-runner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the batch runner**

`src/runner/batch-runner.ts`:

```ts
import type { Browser } from 'playwright';
import type { BatchManifest, CaptureConfig, RunMetadata } from '../contracts.js';
import { launchBrowser } from '../browser/launch.js';
import { hashJson, newAttemptId, newRunId, queryAttemptIdFor, queryIdFor } from '../ids.js';
import { attemptRelativeDir, isoWithOffset } from '../naming.js';
import { LocalArtifactStore } from '../storage/local.js';
import { createManifest, exitCodeFor, finalizeManifest, markRunning, markSkipped, recordQueryAttempt } from './manifest.js';
import { runQueryAttempt, TransientBrowserError, type QueryRunnerDeps } from './query-runner.js';

export const ADAPTER_VERSION = 'maps-feed-card/v1';

export interface BatchDeps {
  config: CaptureConfig;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  launch?: () => Promise<Browser>;
  searchUrlFor?: (keyword: string) => string;
  openSearchImpl?: QueryRunnerDeps['openSearchImpl'];
  signal?: AbortSignal;
}

export interface BatchOutput { manifest: BatchManifest; attemptRoot: string; manifestPath: string; exitCode: 0 | 1 | 2 }

export function batchDeadlineMs(config: CaptureConfig): number {
  const n = config.keywords.length;
  return (60 + n * (config.keywordTimeoutMs / 1000 + 30) + 60) * 1000;
}

export async function runBatch(deps: BatchDeps): Promise<BatchOutput> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const startedAtDate = now();
  const runId = newRunId(startedAtDate);
  const attemptId = newAttemptId();
  const tz = config.filenameTimezone;
  const store = new LocalArtifactStore(config.outputDirectory);
  const attemptRel = attemptRelativeDir(startedAtDate, tz, runId, attemptId);
  const attemptRoot = store.absolutePath(attemptRel);
  const metadata: RunMetadata = {
    configHash: hashJson(config),
    profileHash: hashJson({ surface: 'google-maps-desktop', locale: config.locale, browserTimezoneId: config.browserTimezoneId, viewport: config.viewport, deviceScaleFactor: 1, locationMode: 'query_only', adapterVersion: ADAPTER_VERSION }),
    adapterVersion: ADAPTER_VERSION,
    sourceCommit: process.env['GIT_COMMIT'] ?? null,
    browserVersion: null,
    imageDigest: process.env['IMAGE_DIGEST'] ?? null,
    egressProfileId: process.env['EGRESS_PROFILE_ID'] ?? null,
  };
  const startedAt = isoWithOffset(startedAtDate, tz);
  await store.writeFile(`${attemptRel}/request.json`, JSON.stringify({ runId, attemptId, startedAt, config }, null, 2));

  let manifest = createManifest({ runId, attemptId, startedAt, metadata, persistenceMode: 'local_only', keywords: config.keywords });
  const writeProgress = () => store.writeFile(`${attemptRel}/manifest.progress.json`, JSON.stringify(manifest, null, 2));
  const writeFinal = () => store.writeFile(`${attemptRel}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeProgress();
  log({ stage: 'batch_start', runId, attemptId, keywords: config.keywords.length, attemptRoot });

  let browser: Browser;
  try {
    browser = await (deps.launch ?? launchBrowser)();
  } catch (err) {
    log({ stage: 'browser_startup_failed', runId, attemptId, message: (err as Error).message });
    for (const q of manifest.queries) manifest = markSkipped(manifest, q.queryId, 'browser_startup_failed');
    manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
    await writeFinal();
    return { manifest, attemptRoot, manifestPath: store.absolutePath(`${attemptRel}/manifest.json`), exitCode: exitCodeFor(manifest) };
  }
  manifest = { ...manifest, metadata: { ...metadata, browserVersion: browser.version() } };

  const batchDeadlineAt = startedAtDate.getTime() + batchDeadlineMs(config);
  let breaker = false;
  try {
    for (const [inputIndex, keyword] of config.keywords.entries()) {
      const queryId = queryIdFor(inputIndex);
      if (deps.signal?.aborted) { manifest = markSkipped(manifest, queryId, 'cancelled'); await writeProgress(); continue; }
      if (breaker) { manifest = markSkipped(manifest, queryId, 'batch_blocked'); await writeProgress(); continue; }
      if (Date.now() > batchDeadlineAt) { manifest = markSkipped(manifest, queryId, 'batch_timeout'); await writeProgress(); continue; }

      manifest = markRunning(manifest, queryId);
      const keywordDeadline = Math.min(Date.now() + config.keywordTimeoutMs, batchDeadlineAt);
      const runnerDeps: QueryRunnerDeps = {
        browser, store, config, runId, attemptId, metadata: manifest.metadata, attemptRelativeDir: attemptRel, now, log,
        ...(deps.searchUrlFor ? { searchUrlFor: deps.searchUrlFor } : {}),
        ...(deps.openSearchImpl ? { openSearchImpl: deps.openSearchImpl } : {}),
      };
      let attemptNumber = 1;
      let allowTransientThrow = keywordDeadline - Date.now() > 15_000;
      for (;;) {
        try {
          const out = await runQueryAttempt(runnerDeps, { queryId, inputIndex, keyword, queryAttemptId: queryAttemptIdFor(attemptNumber), deadlineAt: keywordDeadline, allowTransientThrow });
          manifest = recordQueryAttempt(manifest, queryId, out.summary, out.artifacts);
          if (out.summary.status === 'blocked' && out.summary.stopReason === 'captcha') breaker = true;
          break;
        } catch (err) {
          if (err instanceof TransientBrowserError && attemptNumber === 1) {
            log({ stage: 'retry', queryId, message: err.message });
            attemptNumber = 2;
            allowTransientThrow = false;
            continue;
          }
          throw err;
        }
      }
      await writeProgress();
      const row = manifest.queries.find((q) => q.queryId === queryId);
      log({ stage: 'query_done', queryId, status: row?.status, stopReason: row?.stopReason });
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  manifest = finalizeManifest(manifest, isoWithOffset(now(), tz));
  await writeFinal();
  log({ stage: 'batch_done', runId, attemptId, status: manifest.status });
  return { manifest, attemptRoot, manifestPath: store.absolutePath(`${attemptRel}/manifest.json`), exitCode: exitCodeFor(manifest) };
}
```

- [ ] **Step 4: Implement the CLI**

`src/cli.ts`:

```ts
import { ConfigError, loadConfigFile } from './config.js';
import { runBatch } from './runner/batch-runner.js';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<number> {
  const configPath = argValue('--config');
  if (!configPath) {
    process.stderr.write('usage: npm run capture -- --config <keywords.json>\n');
    return 64;
  }
  const { config, duplicateKeywordCount } = await loadConfigFile(configPath);
  if (duplicateKeywordCount > 0) {
    process.stderr.write(`note: ${duplicateKeywordCount} duplicate keyword row(s); each row is collected separately\n`);
  }
  const controller = new AbortController();
  const onSignal = (sig: string) => { process.stderr.write(`${sig} received: finishing the current keyword, skipping the rest\n`); controller.abort(); };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));

  const out = await runBatch({
    config,
    signal: controller.signal,
    log: (event) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`),
  });
  const counts: Record<string, number> = {};
  for (const q of out.manifest.queries) counts[q.status] = (counts[q.status] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({
    summary: true, runId: out.manifest.runId, attemptId: out.manifest.attemptId, status: out.manifest.status,
    counts, manifest: out.manifestPath, remotePersistence: 'not_requested',
  })}\n`);
  return out.exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    if (err instanceof ConfigError) { process.stderr.write(`${err.message}\n`); process.exitCode = err.exitCode; return; }
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/batch-runner.test.ts && npm run typecheck && npm test`
Expected: 5 passed in the batch file; the whole suite green.

Then a CLI smoke check that does not touch Google: `npx tsx src/cli.ts` with no flag must print usage and exit 64:

```bash
npx tsx src/cli.ts; echo "exit=$?"
```
Expected: `exit=64`.

- [ ] **Step 6: Update README sections**

Replace the "Development setup" section body with:

```markdown
```bash
npm ci
npx playwright install chromium
npm test                      # contract type tests + unit and fixture tests
npm run capture -- --config examples/keywords.json
```

`npm run capture` runs the local collector in local-only persistence mode. It launches the bundled Chromium (`channel: "chromium"`), collects each keyword sequentially, and writes `outputs/maps-keyword-capture/<date>/<runId>/<attemptId>/` with `request.json`, per-query `q000N/qa0M/` folders (result JSON, CSV, `observations.jsonl`, PNGs), `manifest.progress.json`, and the final `manifest.json`. The exit code is 0 when every keyword is captured, 2 for a partial batch, 1 for a failed batch, and 64 for an invalid configuration. The summary line printed last includes the manifest path and `remotePersistence: not_requested`.
```

Replace "Next steps" item 1 with `1. Done locally: keyword input, result readiness, scrolling, ad classification, screenshots, and JSON/CSV output. See docs/validation-status.md for what the local run has and has not shown.` and keep items 2 to 4.

- [ ] **Step 7: Commit**

```bash
git add src/runner/batch-runner.ts src/cli.ts tests/batch-runner.test.ts README.md
git commit -m "feat: add sequential batch runner and capture CLI"
```

---

### Task 15: Local live run and validation record (Milestone 2 acceptance)

This task runs the real collector against Google Maps from the developer's machine and records what was observed. It writes no new source code unless a selector fails; a selector fix is its own small TDD cycle against the fixture plus a re-run.

**Files:**
- Modify: `docs/validation-status.md` (add a "Local collector run" section), `docs/implementation-plan.md` (Milestone 2 status line)
- Read: the run's `manifest.json`, one result JSON, one CSV, all PNGs

- [ ] **Step 1: Run the example batch**

```bash
cd /Users/xander/git_repo/maps-keyword-capture
npx playwright install chromium
npm run capture -- --config examples/keywords.json | tee /tmp/capture-run.log; echo "exit=$?"
```

Expected: JSON log lines per stage, a final summary line, exit 0 or 2. Note the manifest path from the summary.

- [ ] **Step 2: Reconcile results with the screenshots by hand**

For each keyword open the result JSON and the PNGs side by side and check:

1. `listings[].displayPosition` order matches the visual order across the screenshots, and each listing's `screenshotIds` point at a PNG in which that card is fully visible with its name legible.
2. Every card visually marked "Sponsored" has `resultType: "ad"` and `organicRank: null`; no card without the label is `ad`.
3. `organicRank` counts only organic cards, in order, and is null after any `unknown`.
4. `observedCount`, `stopReason`, and `status` are consistent with the number of listings and the screenshots (a `captured` result has 15 listings or an end-of-list marker visible in the last PNG).
5. The CSV opens in a spreadsheet with readable non-ASCII text and no cell interpreted as a formula.
6. `context.observedMapView` and `finalUrl` are recorded; for `bubble tea garden city` note whether the listing addresses mix regions (expected from the earlier probe) and do not change the keyword.
7. `manifest.json` lists every keyword with a terminal status and `persistenceStatus: "not_requested"`, and every artifact path exists with the recorded byte count:

```bash
node -e '
const m = require(process.argv[1]); const fs = require("fs"); const path = require("path");
const root = path.dirname(process.argv[1]); let bad = 0;
for (const a of m.artifacts) { const p = path.join(root, a.queryId, a.queryAttemptId, a.filename); const ok = fs.existsSync(p) && fs.statSync(p).size === a.bytes; if (!ok) { bad++; console.log("MISSING/SIZE", p); } }
console.log("artifacts", m.artifacts.length, "bad", bad); process.exit(bad ? 1 : 0);
' <manifest path>
```

- [ ] **Step 3: Exercise one controlled timeout and one clean shutdown**

```bash
# timeout: 5 seconds is below any realistic page load, expect partial/failed with stopReason timeout or a navigation failure, never a hang
node -e 'const c=require("./examples/keywords.json"); c.keywords=c.keywords.slice(0,1); c.keywordTimeoutMs=5000; require("fs").writeFileSync("/tmp/kw-timeout.json", JSON.stringify(c));'
npm run capture -- --config /tmp/kw-timeout.json; echo "exit=$?"

# shutdown: send SIGINT after the first keyword finishes; expect the second keyword skipped/cancelled and manifest.json written
npm run capture -- --config examples/keywords.json & PID=$!; sleep 40; kill -INT $PID; wait $PID; echo "exit=$?"
ps aux | grep -i [c]hrom | wc -l   # expect 0 leftover browser processes
```

- [ ] **Step 4: Record the outcome**

Append to `docs/validation-status.md` a section `## Local collector run (<date>)` with: the run id, browser version from the manifest, per-keyword `status` / `stopReason` / `observedCount` / screenshot count, whether a Sponsored card appeared and was classified `ad`, the reconciliation findings from Step 2 (list any mismatch verbatim), the timeout and shutdown results, and the remaining gaps (no consent or CAPTCHA sample, no target-Pod run, no Azure delivery). Update the Evidence ledger rows for "Query-only input", "Sponsored placement", and "15 listings within 6 scrolls / 5 results screenshots" from the run's actual numbers. In `docs/implementation-plan.md`, add under Milestone 2: `Status <date>: local run completed; see validation-status.md.`

- [ ] **Step 5: Commit**

```bash
git add docs/validation-status.md docs/implementation-plan.md
git commit -m "docs: record local collector run results"
```

Do not commit anything under `outputs/`. If Step 2 finds a mismatch caused by a selector or parser, fix it with a failing fixture test first (Tasks 5, 6, or 11), re-run this task, and record both the defect and the fix.

---

## What this plan does not cover

Milestones 3 and 4 (Azure Blob upload with readback verification, the container image, the Kubernetes Job template, and the target-Pod acceptance run) are a separate plan written after this one has executed, because the selectors, budgets, and page states verified here are inputs to it.

Also deferred from design.md: recycling the browser process every five keywords (one process per batch is enough for 20 keywords locally; revisit with measured memory in the Pod), the 30-second persistence budget (local writes are immediate), and CSV keyword-list input (`--keywords-file`); JSON config is the only input in this plan.
