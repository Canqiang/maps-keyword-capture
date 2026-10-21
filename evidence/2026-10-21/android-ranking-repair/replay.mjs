/** Offline only. Re-read immutable producer receipts; never change historic artifacts. */
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--repo-root', '--evidence-root', '--out'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Expected --repo-root, --evidence-root and --out exactly once');
  options[args[i]] = args[i + 1];
}
if (Object.keys(options).length !== 3) throw new Error('Missing required argument');
const repo = await realpath(options['--repo-root']), evidence = await realpath(options['--evidence-root']);
const output = resolve(options['--out']);
const sha = data => createHash('sha256').update(data).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const index = await json(join(evidence, 'android-export-v3/receipt-index.json'));
const receipts = await json(join(evidence, 'android-export-v3/all-artifact-receipts.json'));
if (index.surface !== 'android' || index.manifestReceipts.length !== 7 || index.resultReceipts.length !== 125) throw new Error('Unexpected original grid scope');
const byKey = new Map(), verified = new Map();
for (const receipt of [...index.manifestReceipts, ...receipts]) {
  const path = await realpath(receipt.path), rel = relative(evidence, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || receipt.bytes > 16 * 1024 * 1024) throw new Error('Receipt path or size outside bounded evidence');
  const bytes = await readFile(path);
  if (bytes.length !== receipt.bytes || sha(bytes) !== receipt.sha256) throw new Error(`Receipt mismatch: ${receipt.key}`);
  if (byKey.has(receipt.key)) throw new Error('Duplicate receipt key');
  byKey.set(receipt.key, receipt); verified.set(receipt.key, bytes);
}
const { parseScreenFrame, reconcileScreenFrames } = await import(pathToFileURL(join(repo, 'src/android/screen-reader.ts')).href);
const { inspectNativeResultList, analyzeScreen } = await import(pathToFileURL(join(repo, 'src/android/ui.ts')).href);
const sourceHashes = {};
for (const name of ['screen-reader', 'ui', 'device', 'runner', 'contracts']) sourceHashes[`src/android/${name}.ts`] = sha(await readFile(join(repo, `src/android/${name}.ts`)));
const rows = [], before = { queries: 0, searchFrames: 0, noCardsQueries: 0, ads: 0, organic: 0, unknown: 0, topVerifiedFirstFrames: 0, reliableExistingPrefixes: 0 }, after = structuredClone(before);
for (const result of index.resultReceipts) {
  const query = JSON.parse(verified.get(result.key));
  const frames = [], nativeKinds = [];
  for (const screen of query.screens) {
    const get = item => { const r = byKey.get(item.relativePath); if (!r || r.sha256 !== item.sha256 || r.bytes !== item.bytes) throw new Error('Selected artifact receipt mismatch'); return verified.get(item.relativePath); };
    const png = get(screen.png), xml = get(screen.xml).toString(), ocr = JSON.parse(get(screen.ocr)), old = JSON.parse(get(screen.screenFrame));
    if (ocr.imageSha256 !== sha(png) || ocr.imageWidth !== screen.width || ocr.imageHeight !== screen.height) throw new Error('Original PNG/OCR identity mismatch');
    if (frames.length === 0 && old.topStateVerified) before.topVerifiedFirstFrames++;
    const frame = parseScreenFrame(ocr, query.keyword, screen.frameId, screen.capturedAt, xml);
    frames.push(frame); nativeKinds.push({ kind: analyzeScreen(xml, query.keyword).kind, backward: inspectNativeResultList(xml, query.keyword)?.canScrollBackward ?? null });
  }
  const replay = reconcileScreenFrames(frames, 20);
  before.queries++; after.queries++; before.searchFrames += frames.length; after.searchFrames += frames.length;
  if (query.stopReason === 'no_cards_recognized') before.noCardsQueries++;
  if (!frames[0]?.cards.length) after.noCardsQueries++;
  if (frames[0]?.topStateVerified) after.topVerifiedFirstFrames++;
  if (query.listingQuality?.rankingReliable) before.reliableExistingPrefixes++;
  if (replay.rankingReliable) after.reliableExistingPrefixes++;
  for (const listing of query.listings) before[listing.resultType === 'ad' ? 'ads' : listing.resultType]++;
  for (const listing of replay.listings) after[listing.resultType === 'ad' ? 'ads' : listing.resultType]++;
  rows.push({ sourceResultKey: result.key, storeId: query.storeId, keyword: query.keyword, pointId: query.location.id,
    original: { status: query.evidenceStatus, stopReason: query.stopReason, rows: query.listings.length },
    offlineReplay: { frames: frames.length, nativeKinds, firstTopVerified: frames[0]?.topStateVerified ?? false, rows: replay.listings.length,
      ads: replay.adCount, organic: replay.organicCount, unknown: replay.unknownCount, sequenceVerified: replay.sequenceVerified,
      existingPrefixReliable: replay.rankingReliable, warnings: replay.warnings } });
}
const report = { schemaVersion: 'android-offline-regression-replay/v1', createdAt: new Date().toISOString(), originalGridRunId: index.gridRunId,
  mode: 'offline_only_no_history_mutation', sourceHashes, originalReceiptObjectsVerified: verified.size, before, after,
  limits: ['Historical query statuses, ranks, screenshots and manifests are unchanged.', 'Only existing frames were reparsed. No new gesture, capture, complete list, absence or customer-local ranking is established.', 'Positive prefix proof is not a full top-20 capture. New native scroll behavior still requires a bounded device run.', 'Unknown photo-discovery layouts and clipped identity gaps remain unqualified.'], rows };
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, before, after, originalReceiptObjectsVerified: verified.size }));
