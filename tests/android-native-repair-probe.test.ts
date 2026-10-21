import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeScreen, inspectNativeAdvertisementMarkers, inspectNativeResultList } from '../src/android/ui.js';

// Byte-for-byte live artifacts, checked against the candidate1 readback receipts.
// See fixtures/android/repair-probe-20261021/provenance-q1-q4.json.
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/android/repair-probe-20261021/${name}.xml`, import.meta.url), 'utf8');
const q1 = (): string => fixture('candidate1-q0001-03');
const q4 = (): string => fixture('candidate1-q0004-01');
const change = (source: string, klass: string, bounds: string, edits: Record<string, string>): string => {
  const result = source.replace(new RegExp(`<${klass.replaceAll('.', '\\.')}[^>]*bounds="${bounds.replace(/[\[\]]/gu, '\\$&')}"[^>]*>`, 'u'), tag => {
    for (const [key, value] of Object.entries(edits)) {
      const attribute = new RegExp(` ${key}="[^"]*"`, 'u');
      tag = attribute.test(tag) ? tag.replace(attribute, ` ${key}="${value}"`) : tag.replace(/(\/?>)$/u, ` ${key}="${value}"$1`);
    }
    return tag;
  });
  expect(result).not.toBe(source);
  return result;
};

describe('candidate1 native layout repair probe', () => {
  it('recognizes the scrolled exact-CJK query with typed filters before a merchant and query-photo module', () => {
    expect(analyzeScreen(q1(), '卤味')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(q1(), '卤味')).toMatchObject({
      bounds: { left: 0, top: 274, right: 720, bottom: 1232 }, canScrollBackward: true, canScrollForward: true,
    });
    expect(inspectNativeResultList(q1(), '卤肉')).toBeNull();
  });

  it.each([
    ['wrong Price role', 'android.widget.Spinner', '[544,274][693,290]', { class: 'android.widget.CompoundButton' }],
    ['wrong Top rated role', 'android.widget.CompoundButton', '[709,274][720,290]', { class: 'android.widget.Spinner' }],
    ['unrecognized filter', 'android.widget.Button', '[544,274][693,290]', { 'content-desc': 'Unknown filter', text: 'Unknown filter' }],
    ['disagreeing wrapper label', 'android.widget.Spinner', '[544,274][693,290]', { 'content-desc': 'Relevance' }],
    ['foreign filter label', 'android.widget.Button', '[709,274][720,290]', { package: 'com.example.other' }],
    ['disabled filter', 'android.widget.Spinner', '[544,274][693,290]', { enabled: 'false' }],
    ['child bounds mismatch', 'android.widget.Button', '[544,274][693,290]', { bounds: '[545,274][693,290]' }],
  ] as const)('rejects the clipped filter strip with %s', (_name, klass, bounds, edits) => {
    expect(inspectNativeResultList(change(q1(), klass, bounds, edits), '卤味')).toBeNull();
  });

  it('retains the module query, parent panel and merchant action requirements', () => {
    for (const modified of [
      q1().replaceAll('Image result for 卤味 posted by', 'Image result for 卤肉 posted by'),
      q1().replaceAll('id/content_container', 'id/other_container'),
      q1().replaceAll('content-desc="Directions"', 'content-desc="Unknown action"'),
      q1().replaceAll(',ACTION_SCROLL_TO_POSITION', ''),
    ]) expect(inspectNativeResultList(modified, '卤味')).toBeNull();
  });

  it('recognizes the initial sponsored merchant whose complete native action strip does not scroll', () => {
    expect(analyzeScreen(q4(), 'hot pot near me')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(q4(), 'hot pot near me')).toMatchObject({
      bounds: { left: 0, top: 456, right: 720, bottom: 1232 }, canScrollBackward: false, canScrollForward: true,
      sheetHandleBounds: { left: 320, top: 352, right: 400, bottom: 360 }, expansionTargetY: 160,
    });
    expect(inspectNativeAdvertisementMarkers(q4()).map(marker => ({ kind: marker.kind, cardBounds: marker.cardBounds }))).toEqual([
      { kind: 'sponsored', cardBounds: { left: 0, top: 552, right: 720, bottom: 1168 } },
      { kind: 'disclosure', cardBounds: { left: 0, top: 552, right: 720, bottom: 1168 } },
    ]);
  });

  it.each([
    ['non-clickable action strip', 'android.widget.HorizontalScrollView', '[0,1048][720,1144]', { clickable: 'false' }],
    ['wrong row role', 'android.widget.HorizontalScrollView', '[0,1048][720,1144]', { class: 'android.widget.FrameLayout' }],
    ['unknown action', 'android.view.ViewGroup', '[292,1056][447,1136]', { 'content-desc': 'Unknown action' }],
    ['foreign action', 'android.view.ViewGroup', '[292,1056][447,1136]', { package: 'com.example.other' }],
    ['disabled action', 'android.view.ViewGroup', '[292,1056][447,1136]', { enabled: 'false' }],
    ['out-of-row action', 'android.view.ViewGroup', '[292,1056][447,1136]', { bounds: '[292,1040][447,1136]' }],
    ['labeled icon', 'android.widget.ImageView', '[316,1078][352,1114]', { 'content-desc': 'Unknown control' }],
    ['displaced empty next-card wrapper', 'android.view.ViewGroup', '[0,1184][720,1232]', { bounds: '[0,1185][720,1232]' }],
    ['labeled next-card wrapper', 'android.view.ViewGroup', '[0,1184][720,1232]', { 'content-desc': 'Unknown card' }],
  ] as const)('rejects the non-scrolling action layout with %s', (_name, klass, bounds, edits) => {
    expect(inspectNativeResultList(change(q4(), klass, bounds, edits), 'hot pot near me')).toBeNull();
  });

  it('rejects extra native action descendants and absent list-scroll proof', () => {
    const extra = q4().replace(/(<android\.view\.ViewGroup[^>]*bounds="\[292,1056\]\[447,1136\]"[^>]*>)/u,
      '$1<node class="android.widget.TextView" package="com.google.android.apps.maps" text="Unknown overlay" enabled="true" bounds="[292,1056][447,1136]"/>');
    expect(extra).not.toBe(q4());
    for (const modified of [extra, q4().replaceAll(',ACTION_SCROLL_TO_POSITION', ''), q4().replaceAll(',ACTION_SCROLL_FORWARD', '')]) {
      expect(inspectNativeResultList(modified, 'hot pot near me')).toBeNull();
    }
  });
});
