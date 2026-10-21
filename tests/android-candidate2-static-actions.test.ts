import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';
import { parseScreenFrame, reconcileScreenFrames, type ScreenOcr } from '../src/android/screen-reader.js';

// Exact terminal artifacts, independently checked against producer receipts.
// See provenance-candidate2-static-actions.json; images were visually reviewed.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const fixture = (query: number, shot: number, suffix = 'xml'): string => readFileSync(
  new URL(`candidate2-q${String(query).padStart(4, '0')}-${String(shot).padStart(2, '0')}.${suffix}`, root), 'utf8');
function change(source: string, klass: string, bounds: string, edits: Record<string, string>): string {
  const result = source.replace(new RegExp(`<${klass.replaceAll('.', '\\.')}[^>]*bounds="${bounds.replace(/[\[\]]/gu, '\\$&')}"[^>]*>`, 'u'), tag => {
    for (const [key, value] of Object.entries(edits)) {
      const attribute = new RegExp(` ${key}="[^"]*"`, 'u');
      tag = attribute.test(tag) ? tag.replace(attribute, ` ${key}="${value}"`) : tag.replace(/(\/?>)$/u, ` ${key}="${value}"$1`);
    }
    return tag;
  });
  expect(result).not.toBe(source);
  return result;
}
const cases = [
  { query: 2, shot: 2, keyword: 'chinese food', top: 272, rowTop: 1032, rowBottom: 1128 },
  { query: 4, shot: 2, keyword: 'hot pot near me', top: 272, rowTop: 1032, rowBottom: 1128 },
  { query: 5, shot: 6, keyword: 'bakery', top: 274, rowTop: 494, rowBottom: 590 },
];
describe.each(cases)('candidate2 q$query exact static action strip', ({ query, shot, keyword, top, rowTop, rowBottom }) => {
  it('recognizes its complete native action row without treating promo wording as list proof', () => {
    const xml = fixture(query, shot);
    expect(analyzeScreen(xml, keyword)).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(xml, keyword)).toMatchObject({
      bounds: { left: 0, top, right: 720, bottom: 1232 }, canScrollForward: true, canScrollBackward: query === 5,
    });
    expect(inspectNativeResultList(xml, `${keyword} wrong`)).toBeNull();
  });
  it.each([
    'unknown-action', 'wrong-order', 'foreign-action', 'disabled-action', 'missing-click', 'button-outside-row',
    'labeled-icon', 'extra-icon-descendant', 'wrong-row-role', 'row-not-clickable', 'scroll-action-on-static-row',
    'grid-bounds-mismatch', 'labeled-card-body', 'misaligned-card-body', 'missing-list-position', 'missing-list-motion',
    'foreign-card-content', 'wrong-panel',
  ])('rejects malformed or unqualified static proof: %s', variant => {
    const xml = fixture(query, shot), row = `[0,${rowTop}][720,${rowBottom}]`, call = `[292,${rowTop + 8}][447,${rowBottom - 8}]`;
    let modified = xml;
    if (variant === 'unknown-action') modified = change(xml, 'android.view.ViewGroup', call, { 'content-desc': 'Unknown action' });
    if (variant === 'wrong-order') modified = xml.replaceAll('content-desc="Directions"', 'content-desc="TEMP"')
      .replaceAll('content-desc="Call"', 'content-desc="Directions"').replaceAll('content-desc="TEMP"', 'content-desc="Call"');
    if (variant === 'foreign-action') modified = change(xml, 'android.view.ViewGroup', call, { package: 'com.example.other' });
    if (variant === 'disabled-action') modified = change(xml, 'android.view.ViewGroup', call, { enabled: 'false' });
    if (variant === 'missing-click') modified = change(xml, 'android.view.ViewGroup', call, { actions: 'ACTION_SELECT,ACTION_SHOW_ON_SCREEN' });
    if (variant === 'button-outside-row') modified = change(xml, 'android.view.ViewGroup', call, { bounds: `[292,${rowTop - 1}][447,${rowBottom - 8}]` });
    if (variant === 'labeled-icon') modified = change(xml, 'android.widget.ImageView', `[316,${rowTop + 30}][352,${rowTop + 66}]`, { 'content-desc': 'Unknown overlay' });
    if (variant === 'extra-icon-descendant') modified = xml.replace(new RegExp(`(<android\\.view\\.ViewGroup[^>]*bounds="\\[292,${rowTop + 8}\\]\\[447,${rowBottom - 8}\\]"[^>]*>)`, 'u'), `$1<node class="android.widget.ImageView" package="com.google.android.apps.maps" enabled="true" bounds="[316,${rowTop + 30}][352,${rowTop + 66}]"/>`);
    if (variant === 'wrong-row-role') modified = change(xml, 'android.widget.HorizontalScrollView', row, { class: 'android.widget.FrameLayout' });
    if (variant === 'row-not-clickable') modified = change(xml, 'android.widget.HorizontalScrollView', row, { clickable: 'false' });
    if (variant === 'scroll-action-on-static-row') modified = change(xml, 'android.widget.HorizontalScrollView', row, { actions: 'ACTION_CLICK,ACTION_SCROLL_FORWARD' });
    if (variant === 'grid-bounds-mismatch') modified = change(xml, 'android.view.ViewGroup', row, { bounds: `[1,${rowTop}][720,${rowBottom}]` });
    if (variant === 'labeled-card-body') modified = change(xml, 'android.view.ViewGroup', query === 5 ? '[0,274][720,614]' : '[0,368][720,1152]', { 'content-desc': 'Unknown card' });
    if (variant === 'misaligned-card-body') modified = change(xml, 'android.view.ViewGroup', query === 5 ? '[0,274][720,614]' : '[0,368][720,1152]', { bounds: query === 5 ? '[1,274][720,614]' : '[1,368][720,1152]' });
    if (variant === 'missing-list-position') modified = xml.replaceAll(',ACTION_SCROLL_TO_POSITION', '');
    if (variant === 'missing-list-motion') modified = xml.replaceAll(',ACTION_SCROLL_FORWARD', '').replaceAll(',ACTION_SCROLL_BACKWARD', '');
    if (variant === 'foreign-card-content') modified = change(xml, 'android.view.ViewGroup', query === 5 ? '[40,318][680,478]' : '[40,856][680,1016]', { package: 'com.example.other' });
    if (variant === 'wrong-panel') modified = xml.replaceAll('id/content_container', 'id/unknown_container');
    expect(modified).not.toBe(xml);
    expect(inspectNativeResultList(modified, keyword)).toBeNull();
  });
});

describe('candidate2 static rows retain advertisement and sequence boundaries', () => {
  function frame(query: number, shot: number, keyword: string) {
    return parseScreenFrame(JSON.parse(fixture(query, shot, 'ocr.json')) as ScreenOcr, keyword,
      `q${query}-frame${shot}`, '2026-10-21', fixture(query, shot));
  }
  it('associates the complete q2 ad and defers the bottom label without inventing a second merchant or end', () => {
    const first = frame(2, 1, 'chinese food'), last = frame(2, 2, 'chinese food');
    expect(last.warnings).toContain('native_trailing_ad_header_pending');
    expect(last.warnings).not.toContain('native_ad_evidence_unresolved');
    expect(last.cards.map(card => [card.name, card.resultType])).toEqual([['Wonder Bayside', 'ad']]);
    expect(last.endOfResults).toBe(false);
    expect(reconcileScreenFrames([first, last], 20)).toMatchObject({ sequenceVerified: true, rankingReliable: true, adCount: 1, organicCount: 0 });
  });
  it('associates q4 ad while the next merchant remains incomplete', () => {
    const last = frame(4, 2, 'hot pot near me');
    expect(last.warnings).not.toContain('native_ad_evidence_unresolved');
    expect(last.cards.map(card => [card.name, card.resultType])).toEqual([['Wonder Financial District', 'ad']]);
    expect(last.endOfResults).toBe(false);
  });
  it('retains native backward-scroll evidence instead of upgrading the q5 frame into a list top', () => {
    const last = frame(5, 6, 'bakery');
    expect(last.sheetBoundarySource).toBe('native_result_list');
    expect(last.topStateVerified).toBe(false);
    expect(last.warnings).toContain('native_list_top_contradicted');
    expect(last.endOfResults).toBe(false);
  });
  it.each([[2, 'chinese food'], [4, 'hot pot near me']] as const)('requires the native filter controls for filtered q%s', (query, keyword) => {
    const xml = fixture(query, 2).replaceAll('Relevance', 'Unknown filter');
    expect(inspectNativeResultList(xml, keyword)).toBeNull();
  });
  it('does not let q2 pending ad markers establish a later organic row', () => {
    const last = frame(2, 2, 'chinese food');
    const result = reconcileScreenFrames([frame(2, 1, 'chinese food'), last], 20);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.organicRank).toBeNull();
    expect(last.warnings).toContain('native_trailing_ad_header_pending');
  });
});
