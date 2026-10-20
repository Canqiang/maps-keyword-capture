import { describe, expect, it } from 'vitest';
import { matchTarget, nameKey, parseScreenFrame, reconcileScreenFrames, targetAliases, validateScreenOcr, type OcrLine, type ScreenOcr } from '../src/android/screen-reader.js';

// Lines modelled on the 2026-10-20 crawler-node probe: Tesseract output for Maps 26.41 at 720x1280.
const line = (text: string, top: number, height = 30, confidence = 90): OcrLine => ({ text, confidence, bounds: { left: 40, top, right: 600, bottom: top + height } });
const ocr = (lines: OcrLine[], sha = 'a'.repeat(64)): ScreenOcr => ({ schemaVersion: 'android-screen-ocr/v1', imageSha256: sha, imageWidth: 720, imageHeight: 1280, engine: 'tesseract', engineVersion: '5', languages: 'eng+chi_sim', scale: 2, lines });

const firstScreen = [
  line('2:44 MITCHELL-LINDEN', 60),                       // status bar and map labels above the sheet
  line('ve braised food X |', 190),                       // map search box, not the sheet
  line('可可小卤KEKE BRAISED DELI', 290),                   // map pin label
  line('braised food x', 410),                            // sheet header: everything above is ignored
  line('= Relevance ~ = Opennow Price ~', 500),
  line('Crown One 御 庭 酒楼', 600, 36),
  line('4.0% (428) . S20-30 . & - Cantonese', 650),
  line('Closed . Opens 9:30 AM - 0 mi', 690),
  line('@ ‘It’s very tasty and the price is good especially', 840),
  line('*® on weekend."', 875),
  line('人 @ Directions Yq Order N Call Q', 960),
  line('Discover through photos', 1110),
];
const secondScreen = [
  line('braised food x', 230),
  line('Q Town Asian Cuisine Inc. Jiang Nan Flust', 550),
  line('Seafood restaurant . 3.1 mi Chinese restaurar', 590),
  line('View photo map >', 690),
  line('BJ BJ/J\\pq KEKE BRAISED DELI', 840, 36, 70),
  line('4.6% (9) - $10-20 - & - Chinese', 890),
  line('- Opens 9:30 AM - 0 mi', 930),
];
const thirdScreen = [
  line('braised food x', 230),
  line('By] By /)\\pg KEKE BRAISED DELI', 300, 36, 55),  // same card, worse OCR, overlapping the previous frame
  line('4.6% (9) . S10-20 . & .Chinese', 350),
  line('Closed . Opens 9:30 AM - 0 mi', 390),
  line('@ Directions — Menu XN Call Q', 520),
  line('Er HOU KOast Unicken', 650, 36, 60),
  line('4.6 % (62) . $20-30 . Chinese', 700),
  line('Closed . Opens 10 AM . 0.2 mi', 740),
  line('"Small take out shop with various braised', 800),
  line('snacks."', 835),
  line('@ Directions Yq Order — Menu \\', 900),
  line('Mr KEKE', 1000, 36),
  line('4.5% (127) - $10-20 - Chinese', 1050),
  line('Closed . Opens 9:30 AM - 0 mi', 1090),
];

describe('parseScreenFrame', () => {
  it('reads the first card below the sheet header and ignores map labels above it', () => {
    const frame = parseScreenFrame(ocr(firstScreen), 'braised food', 'q0001:frame-001', '2026-10-20T06:17:59Z');
    expect(frame.queryVisible).toBe(true);
    expect(frame.sheetTop).toBe(440);
    expect(frame.cards).toHaveLength(1);
    expect(frame.cards[0]).toMatchObject({ name: 'Crown One 御 庭 酒楼', rating: 4, reviewCount: 428, priceText: '$20–30', category: 'cantonese', distanceText: '0 mi', distanceMeters: 0, openText: 'closed . opens 9:30 am', resultType: 'organic', adLabel: null });
    expect(frame.cards[0]!.bounds).toEqual({ left: 40, top: 600, right: 600, bottom: 720 });
  });
  it('joins a wrapped two-line name and keeps the photo module out of the cards', () => {
    const lines = [line('braised food x', 230), line('Golden Corner Noodles 黄金角 (温州小', 600, 36), line('池)', 640, 36), line('4.1% (134) - $10-20 - Chinese', 690), line('Closed . Opens 9:30 AM - 0.1 mi', 730)];
    const frame = parseScreenFrame(ocr(lines), 'braised food', 'f', 't');
    expect(frame.cards.map(card => card.name)).toEqual(['Golden Corner Noodles 黄金角 (温州小 池)']);
    const second = parseScreenFrame(ocr(secondScreen), 'braised food', 'f', 't');
    expect(second.cards).toHaveLength(1);
    expect(second.cards[0]).toMatchObject({ name: 'BJ BJ/J\\pq KEKE BRAISED DELI', rating: 4.6, reviewCount: 9, priceText: '$10–20', openText: 'opens 9:30 am', distanceText: '0 mi' });
  });
  it('recognizes a Sponsored label above the name as an ad and reads a distance on the rating line', () => {
    const lines = [line('卤味 共', 230), line('= Relevance ~ Opennow Price v', 320), line('Sponsored :', 400, 26), line('Xiao Mao Market', 450, 36), line('5.0% (2) - Wholesaler - 0.5 mi', 500), line('Closed . Opens 9 AM', 540), line('Health-preserving tea', 650), line('Our store offers a variety of', 700), line('nuts, as well as flower and fruit healt... Visit Site', 735), line('@ Directions N Call @ Website', 830), line('Er Hou Roast Chicken', 960, 36), line('4.6 & (62) . $20-30 . Chinese', 1010), line('Closed . Opens 10 AM . 0.2 mi', 1050)];
    const frame = parseScreenFrame(ocr(lines), '卤味', 'f', 't');
    expect(frame.queryVisible).toBe(true);
    expect(frame.cards.map(card => [card.name, card.resultType, card.adLabel, card.distanceText, card.category])).toEqual([
      ['Xiao Mao Market', 'ad', 'Sponsored :', '0.5 mi', 'wholesaler'], ['Er Hou Roast Chicken', 'organic', null, '0.2 mi', 'chinese']]);
    expect(frame.cards[0]!.bounds.top).toBe(400);
  });
  it('marks a rating line without a visible name as clipped and unknown', () => {
    const lines = [line('braised food x', 230), line('4.8% (39700) . & . Steak', 260), line('Closed . Opens 11 AM . 349 ft', 300), line('@ Directions Reserve Order', 420)];
    const frame = parseScreenFrame(ocr(lines), 'braised food', 'f', 't');
    expect(frame.cards[0]).toMatchObject({ name: null, resultType: 'unknown', rating: 4.8, reviewCount: 39700, distanceText: '349 ft', distanceMeters: 106, warnings: ['name_clipped_at_top'] });
  });
  it('parses compact review counts and explicit no-review cards', () => {
    const lines = [line('braised food x', 230), line('Tiny Place', 300, 36), line('No reviews · Chinese', 350), line('Big Place', 500, 36), line('4.7 * (1.8K) . $$ . Steak', 550)];
    const frame = parseScreenFrame(ocr(lines), 'braised food', 'f', 't');
    expect(frame.cards.map(card => [card.name, card.rating, card.reviewCount, card.priceText, card.resultType])).toEqual([['Tiny Place', null, 0, null, 'organic'], ['Big Place', 4.7, 1800, '$$', 'organic']]);
  });
  it('reports a missing sheet header and an empty card set', () => {
    const frame = parseScreenFrame(ocr([line('Search here', 200), line('Restaurants Hotels Coffee', 300)]), 'braised food', 'f', 't');
    expect(frame.queryVisible).toBe(false);
    expect(frame.cards).toEqual([]);
    expect(frame.warnings).toContain('no_cards_recognized');
  });
});

describe('reconcileScreenFrames', () => {
  const frames = [
    parseScreenFrame(ocr(firstScreen), 'braised food', 'f1', 't1'),
    parseScreenFrame(ocr(secondScreen), 'braised food', 'f2', 't2'),
    parseScreenFrame(ocr(thirdScreen), 'braised food', 'f3', 't3'),
  ];
  it('keeps the reviewed probe raw cards but withholds ranks after its missing overlap', () => {
    const result = reconcileScreenFrames(frames, 15);
    expect(result.listings.map(l => [l.displayPosition, l.organicRank, l.name, l.frameIds])).toEqual([
      [1, 1, 'Crown One 御 庭 酒楼', ['f1']],
      [2, null, 'BJ BJ/J\\pq KEKE BRAISED DELI', ['f2', 'f3']],
      [3, null, 'Er HOU KOast Unicken', ['f3']],
      [4, null, 'Mr KEKE', ['f3']],
    ]);
    expect(result).toMatchObject({ organicCount: 4, adCount: 0, unknownCount: 0, rankingReliable: false });
    // The merged card keeps the field the second observation filled in.
    expect(result.listings[1]!.openText).toBe('opens 9:30 am');
  });
  it('gives ads a display position but no organic rank, and lowers reliability for unknown cards', () => {
    const ad = parseScreenFrame(ocr([line('卤味 共', 230), line('Sponsored', 300), line('Xiao Mao Market', 340, 36), line('5.0% (2) - Wholesaler - 0.5 mi', 390), line('4.9% (55) - Chinese', 600), line('Named Place', 800, 36), line('4.2% (10) - Chinese', 850)]), '卤味', 'f', 't');
    const result = reconcileScreenFrames([ad], 15);
    expect(result.listings.map(l => [l.displayPosition, l.organicRank, l.resultType])).toEqual([[1, null, 'ad'], [2, null, 'unknown'], [3, null, 'organic']]);
    expect(result.rankingReliable).toBe(false);
    expect(result.warnings).toContain('unknown_cards_precede_organic_ranks');
  });
  it('does not identify garbled CJK names by coincident rating/reviews/distance', () => {
    const a = parseScreenFrame(ocr([line('卤味 共', 230), line('源 宝 (AR PIG) FA)', 300, 36, 40), line('2.8% (31) - Chinese', 350), line('Closed . Opens 11 AM - 8.1 mi', 390)]), '卤味', 'f1', 't');
    const b = parseScreenFrame(ocr([line('卤味 共', 230), line('源 宝 ( 香 美 鹵 味 砂鍋 )', 300, 36, 75), line('2.8% (31) - Chinese', 350), line('Closed . Opens 11 AM - 8.1 mi', 390), line('源 宝 (BRP R A)', 700, 36), line('2.5% (47) - Chinese', 750), line('Closed . Opens 11 AM - 7.9 mi', 790)]), '卤味', 'f2', 't');
    const result = reconcileScreenFrames([a, b], 15);
    expect(result.listings.map(l => [l.displayPosition, l.name, l.reviewCount])).toEqual([[1, '源 宝 (AR PIG) FA)', 31], [2, '源 宝 ( 香 美 鹵 味 砂鍋 )', 31], [3, '源 宝 (BRP R A)', 47]]);
    expect(result.rankingReliable).toBe(false);
  });
  it('preserves a clipped occurrence instead of merging it by missing identity', () => {
    const clipped = parseScreenFrame(ocr([line('braised food x', 230), line('4.6% (9) - $10-20 - Chinese', 260), line('Closed . Opens 9:30 AM - 0 mi', 300)]), 'braised food', 'f1', 't');
    const full = parseScreenFrame(ocr(secondScreen), 'braised food', 'f2', 't');
    const result = reconcileScreenFrames([clipped, full, frames[2]!], 2);
    expect(result.listings.map(l => [l.displayPosition, l.name, l.resultType])).toEqual([[1, null, 'unknown'], [2, 'BJ BJ/J\\pq KEKE BRAISED DELI', 'organic']]);
    expect(result.listings.every(row => row.organicRank === null)).toBe(true);
  });
});

describe('continuous reviewed OCR overlap', () => {
  it('ranks a verified top frame and the next frame with a shared full occurrence', () => {
    const top = parseScreenFrame(ocr([...secondScreen, line('Relevance Open now Price', 300)]), 'braised food', 'top', 't');
    const next = parseScreenFrame(ocr(thirdScreen), 'braised food', 'next', 't');
    const result = reconcileScreenFrames([top, next], 20);
    expect(result.rankingReliable).toBe(true);
    expect(result.listings.map(row => [row.name, row.organicRank])).toEqual([['BJ BJ/J\\pq KEKE BRAISED DELI', 1], ['Er HOU KOast Unicken', 2], ['Mr KEKE', 3]]);
  });
});

describe('target matching', () => {
  it('uses aliases to find the monitored listing but not a sibling brand', () => {
    const listings = reconcileScreenFrames([parseScreenFrame(ocr(firstScreen), 'braised food', 'f1', 't'), parseScreenFrame(ocr(secondScreen), 'braised food', 'f2', 't'), parseScreenFrame(ocr(thirdScreen), 'braised food', 'f3', 't')], 15).listings;
    const aliases = targetAliases({ storeName: 'Keke Food 可可小卤 — Flushing', aliases: ['可可小卤', 'KEKE BRAISED DELI'] });
    expect(matchTarget(listings, aliases)).toEqual({ match: { displayPosition: 2, organicRank: null, name: 'BJ BJ/J\\pq KEKE BRAISED DELI', alias: 'KEKE BRAISED DELI' }, matches: [{ displayPosition: 2, organicRank: null, name: 'BJ BJ/J\\pq KEKE BRAISED DELI', alias: 'KEKE BRAISED DELI' }] });
    expect(matchTarget(listings, ['Mr KEKE']).match?.displayPosition).toBe(4);
    expect(matchTarget(listings, targetAliases({ storeName: 'Keke Food 可可小卤 — Flushing' })).match).toBeNull();
  });
  it('normalizes names for identity keys', () => {
    expect(nameKey('可 可 小 卤 KEKE  BRAISED-DELI')).toBe('可可小卤kekebraiseddeli');
    expect(targetAliases({ storeName: ' Only Bear ' })).toEqual(['Only Bear']);
  });
});

describe('validateScreenOcr', () => {
  it.each([NaN, Infinity, -1, 101])('rejects a non-confidence value %s before classification', confidence => {
    expect(() => validateScreenOcr(ocr([line('Target Deli', 200, 30, confidence)]))).toThrow();
  });
  it('accepts the engine payload and rejects malformed lines', () => {
    expect(() => validateScreenOcr(ocr(firstScreen))).not.toThrow();
    expect(() => validateScreenOcr({ ...ocr(firstScreen), imageSha256: 'short' })).toThrow();
    expect(() => validateScreenOcr(ocr([{ text: 'x', confidence: 1, bounds: { left: 10, top: 10, right: 5, bottom: 20 } }]))).toThrow();
  });
});


describe('review regressions: occurrence and ranking proof', () => {
  const frame = (names: Array<{ name: string; reviews?: number; ad?: string; confidence?: number; distance?: string }>, id = 'f1', top = true) => parseScreenFrame(ocr([
    line('noodles x', 200), ...(top ? [line('Relevance Open now Price', 240)] : []),
    ...names.flatMap((item, i) => [...(item.ad ? [line(item.ad, 320 + i * 220, 25, item.ad === 'Sponsored' ? 90 : 20)] : []),
      line(item.name, 360 + i * 220, 30, item.confidence ?? 90), line(`4.6 (9${item.reviews ?? ''}) · Chinese`, 400 + i * 220),
      ...(item.distance ? [line(`Closed · ${item.distance}`, 440 + i * 220)] : [])]),
  ]), 'noodles', id, '2026-10-20T06:00:00Z');
  it('keeps ad and organic occurrences of the same merchant in one screenshot', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Keke Deli', ad: 'Sponsored' }, { name: 'Keke Deli' }])], 20);
    expect(result.listings.map(row => [row.resultType, row.organicRank])).toEqual([['ad', null], ['organic', 1]]);
    expect(result.listings.map(row => row.frameIds)).toEqual([['f1'], ['f1']]);
  });
  it('keeps unrelated equal-rating/review merchants and same-name branches', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Alpha Deli' }, { name: 'Bravo Noodles' }, { name: 'Alpha Deli', reviews: 1 }])], 20);
    expect(result.listings.map(row => row.name)).toEqual(['Alpha Deli', 'Bravo Noodles', 'Alpha Deli']);
  });
  it('retains raw later cards but withholds their ranks without ordered overlap', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Alpha Deli' }]), frame([{ name: 'Bravo Noodles' }], 'f2', false)], 20);
    expect(result.listings.map(row => row.organicRank)).toEqual([1, null]);
    expect(result.rankingReliable).toBe(false);
  });
  it('does not merge unrelated merchants sharing a generic name word and equal metadata', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Alpha Deli', distance: '0.2 mi' }]), frame([{ name: 'Bravo Deli', distance: '0.2 mi' }], 'f2', false)], 20);
    expect(result.listings.map(row => row.name)).toEqual(['Alpha Deli', 'Bravo Deli']);
    expect(result.rankingReliable).toBe(false);
  });
  it('rejects a backwards/reordered overlap as continuity evidence', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Alpha Deli' }, { name: 'Bravo Noodles' }]), frame([{ name: 'Alpha Deli' }, { name: 'Charlie Deli' }], 'f2', false)], 20);
    expect(result.rankingReliable).toBe(false);
    expect(result.listings.at(-1)?.organicRank).toBeNull();
  });
  it('withholds numeric ranks when the initial screenshot lacks list-top controls', () => {
    const result = reconcileScreenFrames([frame([{ name: 'Target Deli' }], 'f1', false)], 20);
    expect(result.listings[0]?.organicRank).toBeNull();
    expect(result.rankingReliable).toBe(false);
  });
  it.each([{ name: 'Target Deli', confidence: 0 }, { name: 'Target Deli', ad: 'Spons0red' }])('withholds uncertain identity or ad classification %#', candidate => {
    const result = reconcileScreenFrames([frame([candidate])], 20);
    expect(result.listings[0]?.organicRank).toBeNull();
    expect(result.rankingReliable).toBe(false);
    if (candidate.confidence === 0) expect(matchTarget(result.listings, ['Target Deli']).match).toBeNull();
  });
  it('accepts configured two-character CJK aliases without accepting two-letter Latin substrings', () => {
    const result = reconcileScreenFrames([frame([{ name: '天府川菜' }])], 20);
    expect(matchTarget(result.listings, ['天府']).match?.name).toBe('天府川菜');
    expect(matchTarget(result.listings, ['fu']).match).toBeNull();
  });
  it('does not assign a numeric organic rank after an unresolved card', () => {
    const f = frame([{ name: 'Target Deli' }]);
    f.cards.unshift({ ...f.cards[0]!, name: null, nameConfidence: null, resultType: 'unknown', cardIndex: 0 });
    const result = reconcileScreenFrames([f], 20);
    expect(result.listings.at(-1)?.organicRank).toBeNull();
  });
});
