import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { anchoredContinuity, parseScreenFrame, reconcileScreenFrames, type ScreenOcr, type ScreenFrame } from '../src/android/screen-reader.js';
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

const fixture = (name: string) => readFileSync(new URL(`./fixtures/android/release-20261023/${name}`, import.meta.url), 'utf8');
describe('real scrollbar and terminal footer evidence', () => {
  const solo = (n: number, mutate?: (o: ScreenOcr) => void) => {
    const o = JSON.parse(fixture(`keke-solo-0${n}.ocr.json`)); mutate?.(o);
    return parseScreenFrame(o,'braised food flushing',`f${n}`,'t',fixture(`keke-solo-0${n}.xml`));
  };
  it('excludes only the thin right-edge scrollbar word before computing rating geometry', () => {
    const frames=[1,2,3].map(n=>solo(n));
    expect(frames[2]!.cards[0]).toMatchObject({name:'Woodam',resultType:'unknown',ratingBounds:{top:344,right:480}});
    // Near-edge header remains unknown in this frame; only proven previous overlap restores its classification.
    expect(reconcileScreenFrames(frames,20)).toMatchObject({sequenceVerified:true,rankingReliable:true,organicCount:3});
  });
  it.each(['interior','text','wide'])('retains a %s word rather than suppressing evidence', kind => {
    const f=solo(3,o=>{const line=o.lines.find(l=>l.text.endsWith('Korean |'))!,w=line.words!.at(-1)!;
      if(kind==='interior')w.bounds.left=600;
      if(kind==='wide')w.bounds.left=690;
      if(kind==='text'){w.text='Sponsored';line.text=line.text.replace(/\|$/,'Sponsored');}
    });
    expect(f.cards[0]!.ratingBounds!.right).toBeGreaterThan(700);
  });
  it.each(['confidence','bounds','text'])('declines geometry normalization for invalid or inconsistent word %s', kind => {
    const f=solo(3,o=>{const line=o.lines.find(l=>l.text.endsWith('Korean |'))!,w=line.words![0]!;
      if(kind==='confidence')w.confidence=NaN;
      if(kind==='bounds')w.bounds.left=-1;
      if(kind==='text')w.text='Sponsored';
    });
    expect(f.cards[0]!.ratingBounds!.right).toBeGreaterThan(700);
  });
  const footer = (xml: string, o=JSON.parse(fixture('onlybear-footer.ocr.json'))) => parseScreenFrame(o,'bubble tea garden city','f','t',xml);
  it('accepts the supported terminal footer only with native no-forward proof and matching visible OCR', () => {
    expect(footer(fixture('onlybear-footer.xml')).endOfResults).toBe(true);
  });
  it('rejects missing footer, scrollable list, wrong query and missing OCR title', () => {
    const xml=fixture('onlybear-footer.xml');
    expect(footer(xml.replaceAll('Add a missing place','Another button')).endOfResults).toBe(false);
    expect(footer(xml.replaceAll('ACTION_SCROLL_BACKWARD','ACTION_SCROLL_FORWARD')).endOfResults).toBe(false);
    expect(footer(xml.replaceAll('bubble tea garden city','other query')).endOfResults).toBe(false);
    const o=JSON.parse(fixture('onlybear-footer.ocr.json'));o.lines=o.lines.filter((l:{text:string})=>!l.text.includes('Looking for someplace'));
    expect(footer(xml,o).endOfResults).toBe(false);
  });
});
