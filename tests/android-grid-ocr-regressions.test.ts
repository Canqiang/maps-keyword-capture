import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScreenFrame, reconcileScreenFrames, type ScreenOcr } from '../src/android/screen-reader.js';
import { inspectNativeResultList } from '../src/android/ui.js';

const root = new URL('./fixtures/android/grid-v3-20261020/', import.meta.url);
const fixture = (name: string, keyword: string, native = true) => {
  const ocr = JSON.parse(readFileSync(new URL(`${name}.ocr.json`, root), 'utf8')) as ScreenOcr;
  const xml = readFileSync(new URL(`${name}.xml`, root), 'utf8');
  return { ocr, xml, frame: parseScreenFrame(ocr, keyword, name, '2026-10-20', native ? xml : undefined) };
};

describe('receipt-verified Android grid regressions', () => {
  it.each([
    ['nong-rating-star', 'chinese braised food flushing', 'Nong Geng Ji', 4.6, 547],
    ['congee-rating-star', 'chinese food flushing', 'Congee Village Flushing', 3.9, 1256],
    ['congee-rating-star-south', 'chinese food flushing', 'Congee Village Flushing', 3.9, 1256],
  ])('recognizes the visible rating when the star became CJK: %s', (name, keyword, expectedName, rating, reviewCount) => {
    const { frame } = fixture(String(name), String(keyword));
    expect(frame.cards).toHaveLength(1);
    expect(frame.cards[0]?.name).toContain(expectedName);
    expect(frame.cards[0]).toMatchObject({ rating, reviewCount });
    expect(frame.warnings).not.toContain('no_cards_recognized');
  });

  it('keeps a positive Sponsored classification when OCR misses the sheet title', () => {
    const { frame } = fixture('wonder-ad-no-ocr-header', 'chinese food flushing');
    expect(frame.cards).toHaveLength(1);
    expect(frame.cards[0]).toMatchObject({ name: 'Wonder Fresh Meadows', resultType: 'ad', reviewCount: 0 });
    expect(frame.cards[0]?.adLabel).toMatch(/^Sponsored/);
    expect(frame.queryVisible).toBe(true);
    expect(frame.topStateVerified).toBe(false); // native list has already scrolled
    expect(reconcileScreenFrames([frame], 20).sequenceVerified).toBe(false);
  });

  it('uses the exact native CJK query and native list top, not garbled OCR, for sheet context', () => {
    const { frame, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    expect(inspectNativeResultList(xml, '卤味')?.canScrollBackward).toBe(false);
    expect(frame.cards[0]).toMatchObject({ name: 'Sweet Bamboo Chinese Food | Hillside', resultType: 'ad', rating: 4, reviewCount: 262 });
    expect(frame.queryVisible).toBe(true);
    expect(frame.topStateVerified).toBe(true);
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ sequenceVerified: true, adCount: 1, unknownCount: 0 });
  });

  it('does not promote an unknown native photo layout to a verified list top', () => {
    const { frame, xml } = fixture('center-top', 'braised food');
    expect(inspectNativeResultList(xml, 'braised food')).toBeNull();
    expect(frame.topStateVerified).toBe(false);
    expect(reconcileScreenFrames([frame], 20).rankingReliable).toBe(false);
  });

  it.each(['nong-rating-star', 'congee-rating-star', 'congee-rating-star-south'])('recognizes the observed restaurant filter row without inventing a Relevance control: %s', name => {
    const keyword = name === 'nong-rating-star' ? 'chinese braised food flushing' : 'chinese food flushing';
    const { xml, frame } = fixture(name, keyword);
    expect(inspectNativeResultList(xml, keyword)).toMatchObject({ canScrollBackward: false, canScrollForward: true });
    expect(frame.topStateVerified).toBe(true);
    expect(frame.cards[0]?.resultType).toBe(name.startsWith('congee') ? 'ad' : 'organic');
    // The alternate row must contain all four observed native controls.
    expect(inspectNativeResultList(xml.replaceAll('content-desc="Price"', 'content-desc="Different"').replaceAll('text="Price"', 'text="Different"'), keyword)).toBeNull();
    expect(inspectNativeResultList(xml, 'another query')).toBeNull();
  });

  it('does not attach another query or another image size to the OCR evidence', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const wrongQuery = parseScreenFrame(ocr, 'different query', 'wrong', 't', xml);
    expect(wrongQuery.topStateVerified).toBe(false);
    expect(wrongQuery.queryVisible).toBe(false);
    const wrongImage = parseScreenFrame({ ...ocr, imageWidth: 360, imageHeight: 640 }, '卤味', 'wrong-size', 't', xml);
    expect(wrongImage.topStateVerified).toBe(false);
  });

  it('preserves a clipped unidentified repeat as uncertain, never merges by rating alone', () => {
    const before = fixture('wonder-before-clip', 'braised food').frame;
    const after = fixture('wonder-clipped', 'braised food').frame;
    const result = reconcileScreenFrames([before, after], 20);
    expect(after.cards[0]).toMatchObject({ name: null, resultType: 'unknown', rating: 4.7, reviewCount: 41 });
    expect(result.sequenceVerified).toBe(false);
    expect(result.listings.some(row => row.name === null && row.organicRank === null)).toBe(true);
  });

  it('does not mistake rating-like prose or an invalid rating for a card', () => {
    const { ocr } = fixture('congee-rating-star', 'chinese food flushing');
    for (const text of ['3.9 公里 (1256)', '3.9 人次 (1256)', '5.9 ★ (1256)', '3.9A (1256)']) {
      const changed = structuredClone(ocr);
      changed.lines = changed.lines.map(line => /^3\.9/.test(line.text) ? { ...line, text } : line);
      expect(parseScreenFrame(changed, 'chinese food flushing', 'negative', 't').cards, text).toHaveLength(0);
    }
  });
  it.each(['name', 'rating'])('keeps a legible Sponsored label but rejects rank proof when %s confidence is low', field => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = structuredClone(ocr);
    changed.lines = changed.lines.map(line =>
      (field === 'name' ? line.text.startsWith('Sweet Bamboo') : line.text.startsWith('4.0')) ? { ...line, confidence: 20 } : line);
    const frame = parseScreenFrame(changed, '卤味', 'low-confidence', 't', xml);
    expect(frame.cards[0]?.resultType).toBe('ad');
    expect(frame.cards[0]?.warnings).toContain(field === 'name' ? 'low_name_confidence' : 'low_rating_confidence');
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ adCount: 1, unknownCount: 0, rankingReliable: false });
  });

  it('never turns the real native Sponsored card into organic when OCR misses only its ad label', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = { ...ocr, lines: ocr.lines.filter(line => !/sponsored/i.test(line.text)) };
    const frame = parseScreenFrame(changed, '卤味', 'native-ad', 't', xml);
    expect(frame.cards[0]).toMatchObject({ name: 'Sweet Bamboo Chinese Food | Hillside', resultType: 'ad', adLabel: 'Sponsored' });
    expect(frame.cards[0]?.warnings).toContain('native_ad_label_confirmed');
    expect(reconcileScreenFrames([frame], 20).listings[0]?.organicRank).toBeNull();
  });

  it.each(['disclosure-only', 'invalid-bounds', 'outside-owner', 'conflicting-label', 'short-label'])('fails closed for unresolved native ad evidence: %s', variant => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = { ...ocr, lines: ocr.lines.filter(line => !/sponsored/i.test(line.text)) };
    let source = xml;
    if (variant === 'disclosure-only') source = source.replace('content-desc="Sponsored"', 'content-desc=""');
    if (variant === 'invalid-bounds') source = source.replace(/(<android\.view\.ViewGroup[^>]*content-desc="Sponsored"[^>]*bounds=")[^"]+/, '$1invalid');
    if (variant === 'outside-owner') source = source.replace(/(<android\.view\.ViewGroup[^>]*content-desc="Sponsored"[^>]*bounds=")[^"]+/, '$1[0,0][100,50]');
    if (variant === 'conflicting-label') source = source.replace('text="" content-desc="Sponsored"', 'text="Organic" content-desc="Sponsored"');
    if (variant === 'short-label') source = source.replace('content-desc="Sponsored"', 'content-desc="Ad"');
    expect(source).not.toBe(xml);
    const frame = parseScreenFrame(changed, '卤味', 'ambiguous-native-ad', 't', source);
    expect(frame.cards[0]?.resultType).toBe('unknown');
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ rankingReliable: false, sequenceVerified: false });
    expect(reconcileScreenFrames([frame], 20).listings[0]?.organicRank).toBeNull();
  });

  it('does not assign a native ad owner to two separate OCR merchant headers', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = structuredClone(ocr);
    changed.lines = changed.lines.filter(line => !/sponsored/i.test(line.text) && line.bounds.top < 610);
    changed.lines.push(
      { text: 'Different Merchant', confidence: 90, bounds: { left: 42, top: 665, right: 400, bottom: 700 } },
      { text: '4.7 ★ (18) - Chinese', confidence: 90, bounds: { left: 42, top: 715, right: 400, bottom: 750 } },
    );
    const frame = parseScreenFrame(changed, '卤味', 'ambiguous-owner', 't', xml);
    expect(frame.cards).toHaveLength(2);
    expect(frame.cards.every(card => card.resultType === 'unknown')).toBe(true);
    expect(reconcileScreenFrames([frame], 20).rankingReliable).toBe(false);
  });

  it.each(['text-only', 'matching-text-and-description', 'paid-advertisement'])('cross-checks an explicit native ad label representation: %s', variant => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = { ...ocr, lines: ocr.lines.filter(line => !/sponsored/i.test(line.text)) };
    const replacement = variant === 'text-only' ? 'text="Sponsored" content-desc=""' :
      variant === 'matching-text-and-description' ? 'text="Sponsored" content-desc="Sponsored"' : 'text="" content-desc="Paid advertisement"';
    const source = xml.replace('text="" content-desc="Sponsored"', replacement);
    expect(source).not.toBe(xml);
    const frame = parseScreenFrame(changed, '卤味', 'native-ad-variant', 't', source);
    expect(frame.cards[0]?.resultType).toBe('ad');
    expect(reconcileScreenFrames([frame], 20).listings[0]?.organicRank).toBeNull();
  });

  it('never treats an unmatched native advertisement as an empty reliable result', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const frame = parseScreenFrame({ ...ocr, lines: [] }, '卤味', 'native-ad-without-ocr-card', 't', xml);
    expect(frame.cards).toHaveLength(0);
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ rankingReliable: false, sequenceVerified: false });
  });

  it('does not attach a native ad marker to a different OCR card outside the owning native bounds', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const changed = { ...ocr, lines: ocr.lines.filter(line => !/sponsored/i.test(line.text)) };
    // Change only the ad owner's source ancestry to a short native card. The
    // observed merchant OCR below that owner cannot inherit its advertisement.
    const source = xml.replace(/(<android\.widget\.FrameLayout [^>]*bounds=")\[0,456\]\[720,1232\]/g, '$1[0,456][720,515]');
    const frame = parseScreenFrame(changed, '卤味', 'wrong-native-owner', 't', source);
    expect(frame.cards).toHaveLength(1);
    expect(frame.cards.every(card => card.resultType !== 'organic')).toBe(true);
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ rankingReliable: false, sequenceVerified: false });
  });

  it('fails closed when two overlapping native owners claim the same OCR header', () => {
    const { ocr, xml } = fixture('bamboo-ad-cjk-header', '卤味');
    const start = xml.search(/<android\.widget\.FrameLayout[^>]*bounds="\[0,456\]\[720,1232\]"/);
    expect(start).toBeGreaterThan(0);
    let depth = 0, end = -1;
    for (const token of xml.slice(start).matchAll(/<\/?android\.widget\.FrameLayout\b[^>]*>/g)) {
      if (token[0].startsWith('</')) depth--;
      else if (!token[0].endsWith('/>')) depth++;
      if (depth === 0) { end = start + token.index! + token[0].length; break; }
    }
    expect(end).toBeGreaterThan(start);
    const duplicate = xml.slice(0, end) + xml.slice(start, end) + xml.slice(end);
    expect(inspectNativeResultList(duplicate, '卤味')).not.toBeNull();
    const frame = parseScreenFrame({ ...ocr, lines: ocr.lines.filter(line => !/sponsored/i.test(line.text)) }, '卤味', 'duplicate-owner', 't', duplicate);
    expect(frame.cards[0]?.resultType).toBe('unknown');
    expect(reconcileScreenFrames([frame], 20)).toMatchObject({ rankingReliable: false, sequenceVerified: false });
  });
});
