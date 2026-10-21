import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeScreen, inspectNativeResultList } from '../src/android/ui.js';
import { parseScreenFrame, type ScreenOcr } from '../src/android/screen-reader.js';

// Byte-for-byte probe 7 artifact (run_20261021T042153Z_4f919e, source 8d8ebc5): the photo-discovery
// module beside a merchant card, now showing its "View photo map" control.
const root = new URL('./fixtures/android/repair-probe-20261021/', import.meta.url);
const f13 = (): string => readFileSync(new URL('candidate7-q0005-13.xml', root), 'utf8');
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

describe('candidate8: photo-discovery module with its photo-map control beside a card (probe 7 q0005 frame 13)', () => {
  it('accepts the exact-query list', () => {
    expect(analyzeScreen(f13(), 'bakery')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(f13(), 'bakery')).toMatchObject({ bounds: { left: 0, top: 274, right: 720, bottom: 1232 }, canScrollBackward: true, canScrollForward: true });
    const ocr = JSON.parse(readFileSync(new URL('candidate7-q0005-13.ocr.json', root), 'utf8')) as ScreenOcr;
    expect(parseScreenFrame(ocr, 'bakery', 'q0005:frame-013', '2026-10-21', f13())).toMatchObject({ sheetBoundarySource: 'native_result_list', cards: [] });
  });
  it.each([
    ['wrong class', { class: 'android.widget.Button' }],
    ['not clickable', { clickable: 'false' }],
    ['missing click action', { actions: 'ACTION_SELECT,ACTION_SHOW_ON_SCREEN' }],
    ['wrong label', { 'content-desc': 'View something else' }],
    ['above the photo tiles', { bounds: '[40,900][680,969]' }],
    ['resource id', { 'resource-id': 'com.google.android.apps.maps:id/other' }],
  ] as const)('keeps the dedicated proofs for a photo-map control with %s', (_name, edits) => {
    expect(inspectNativeResultList(change(f13(), 'android.view.ViewGroup', '[40,1163][680,1232]', edits), 'bakery')).toBeNull();
  });
});
