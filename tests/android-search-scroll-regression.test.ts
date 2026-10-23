import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { anchoredContinuity, reconcileScreenFrames, type ScreenFrame } from '../src/android/screen-reader.js';
const frame = (n: number): ScreenFrame => JSON.parse(readFileSync(new URL(`./fixtures/android/release-20261023/keke-frame-${n}.json`, import.meta.url), 'utf8'));
describe('receipt-verified KEKE late-scroll pair', () => {
  it('joins two independent co-moving anchors despite rating separators changing', () => {
    const a = frame(36), b = frame(37); a.topStateVerified = true;
    expect(anchoredContinuity(a, b)).toBeCloseTo(-302.6667, 2);
    const result = reconcileScreenFrames([a,b], 20);
    expect(result.sequenceVerified).toBe(true);
    expect(result.listings).toHaveLength(1);
  });
  it.each(['4.7% (273) .$40-50.barbecue', '4.8% (274) .$40-50.barbecue', '4.8% (273) .$40-60.barbecue', '4.8% (273) .€40-50.barbecue', '4.8% (273) .$40-50.chinese', '4.8% (273) .$4.050.barbecue'])('does not normalize changed facts: %s', text => {
    const a = frame(36), b = frame(37); b.anchors!.find(x => x.text.startsWith('4.8'))!.text = text;
    expect(anchoredContinuity(a,b)).toBeNull();
  });
  it('requires an independent second anchor and consistent motion', () => {
    const a = frame(36), b = frame(37);
    b.anchors = b.anchors!.filter(x => !x.text.includes('pork liver'));
    expect(anchoredContinuity(a,b)).toBeNull();
    const c = frame(37); c.anchors!.find(x => x.text.startsWith('4.8'))!.bounds.top += 30;
    expect(anchoredContinuity(a,c)).toBeNull();
  });
  it('rejects duplicate normalized rating anchors even outside the matching geometry', () => {
    const a = frame(36), b = frame(37), rating = b.anchors!.find(x => x.text.startsWith('4.8'))!;
    b.anchors!.push({ ...structuredClone(rating), text: '4.8% (273) - $40-50 - barbecue', bounds: { ...rating.bounds, top: rating.bounds.top + 200 } });
    expect(anchoredContinuity(a,b)).toBeNull();
  });
  it('does not use separator fallback for multiple cards or absent numeric metadata', () => {
    const a = frame(36), b = frame(37); a.cards.push(structuredClone(a.cards[0]!));
    expect(anchoredContinuity(a,b)).toBeNull();
    const c = frame(36), d = frame(37); c.cards[0]!.rating = d.cards[0]!.rating = null;
    expect(anchoredContinuity(c,d)).toBeNull();
  });
  it('does not override contradictory exact anchors with tolerant matches', () => {
    const a = frame(36), b = frame(37);
    a.anchors!.push({text:'independent exact line',bounds:{left:10,right:300,top:800,bottom:820}});
    b.anchors!.push({text:'independent exact line',bounds:{left:10,right:300,top:700,bottom:720}});
    expect(anchoredContinuity(a,b)).toBeNull();
  });
  it('does not merge conflicting ad classification', () => {
    const a = frame(36), b = frame(37); a.topStateVerified = true;
    b.cards[0]!.resultType = 'ad'; b.cards[0]!.adLabel = 'Sponsored';
    const result = reconcileScreenFrames([a,b],20);
    expect(result.rankingReliable).toBe(false);
  });
});
