import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { analyzeScreen, inspectNativePhotoModuleTail, inspectNativeResultList, parseUiNodes } from '../src/android/ui.js';

describe('Trial18 top-clipped anonymous photo carousel footer', () => {
  const original = (): string => fixture('ranking/native-photo-module-empty-carousel-q0001');
  const change = (source: string, klass: string, bounds: string, edits: Record<string, string>): string => {
    const result = source.replace(new RegExp(`<${klass.replaceAll('.', '\\.')}[^>]*bounds="${bounds.replace(/[\[\]]/gu, '\\$&')}"[^>]*>`, 'u'), tag => {
      for (const [key, value] of Object.entries(edits)) {
        const attribute = new RegExp(` ${key}="[^"]*"`, 'u');
        tag = attribute.test(tag) ? tag.replace(attribute, ` ${key}="${value}"`) : tag.replace(/\/?>$/u, ending => ` ${key}="${value}"${ending}`);
      }
      return tag;
    });
    expect(result).not.toBe(source); return result;
  };
  it.each([
    ['q0001', 'hot pot near me', 469], ['q0002', 'hot pot near me', 469], ['q0003', 'spicy duck neck flushing', 465],
  ] as const)('recognizes the actual %s footer without treating it as a merchant', (query, keyword, bottom) => {
    const source = fixture(`ranking/native-photo-module-empty-carousel-${query}`);
    expect(analyzeScreen(source, keyword).kind).toBe('results');
    expect(inspectNativePhotoModuleTail(source, keyword)).toEqual({ left: 0, top: 274, right: 720, bottom });
    expect(inspectNativeResultList(source, keyword)?.canScrollBackward).toBe(true);
  });
  it.each([
    ['row not clickable', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { clickable: 'false' }],
    ['row not scrollable', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { scrollable: 'false' }],
    ['row missing actions', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { actions: '' }],
    ['row disabled', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { enabled: 'false' }],
    ['row foreign package', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { package: 'com.example.other' }],
    ['row not top clipped', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { bounds: '[0,275][720,301]' }],
    ['row overlapping control', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { bounds: '[0,274][720,350]' }],
    ['row label', 'android.widget.HorizontalScrollView', '[0,274][720,301]', { 'content-desc': 'Directions' }],
    ['grid bounds', 'android.view.ViewGroup', '[0,274][720,301]', { bounds: '[0,274][719,301]' }],
    ['grid clickable', 'android.view.ViewGroup', '[0,274][720,301]', { clickable: 'true' }],
    ['tile foreign package', 'android.view.ViewGroup', '[40,274][486,301]', { package: 'com.example.other' }],
    ['icon foreign package', 'android.widget.ImageView', '[447,371][483,407]', { package: 'com.example.other' }],
    ['tile label', 'android.view.ViewGroup', '[40,274][486,301]', { 'content-desc': 'Sponsored' }],
    ['tile wrong role', 'android.view.ViewGroup', '[40,274][486,301]', { class: 'android.widget.TextView' }],
    ['tile not clickable', 'android.view.ViewGroup', '[40,274][486,301]', { clickable: 'false' }],
    ['tile missing click', 'android.view.ViewGroup', '[40,274][486,301]', { actions: '' }],
    ['tile overlap', 'android.view.ViewGroup', '[502,274][720,301]', { bounds: '[480,274][720,301]' }],
    ['tile height', 'android.view.ViewGroup', '[502,274][720,301]', { bounds: '[502,275][720,301]' }],
    ['tile outside row', 'android.view.ViewGroup', '[502,274][720,301]', { bounds: '[502,274][721,301]' }],
  ] as const)('rejects %s rather than treating it as a proven photo footer', (_label, klass, bounds, edits) => {
    const source = change(original(), klass, bounds, edits);
    expect(inspectNativePhotoModuleTail(source, 'hot pot near me')).toBeNull();
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects a single tile and any extra nested leaf content', () => {
    const tile = /<android\.view\.ViewGroup[^>]*bounds="\[502,274\]\[720,301\]"[^>]*\/>/u;
    const source = original(); expect(source).toMatch(tile);
    for (const modified of [source.replace(tile, ''), source.replace(tile, tag => tag.replace('/>', '><node class="android.widget.ImageView" package="com.google.android.apps.maps" bounds="[502,274][720,301]"/></android.view.ViewGroup>'))]) {
      expect(inspectNativePhotoModuleTail(modified, 'hot pot near me')).toBeNull();
      expect(analyzeScreen(modified, 'hot pot near me').kind).not.toBe('results');
    }
  });
  it('accepts three ordered leaf tiles without a tile-count or pixel-height whitelist', () => {
    let source = original();
    const first = /<android\.view\.ViewGroup[^>]*bounds="\[40,274\]\[486,301\]"[^>]*\/>/u;
    const template = source.match(first)![0];
    source = source.replace(first, template.replace('[40,274][486,301]', '[40,274][250,301]') + template.replace('[40,274][486,301]', '[266,274][486,301]'));
    // Extend the anonymous clipped row within the same module and before its control.
    source = source.replaceAll(',301]', ',325]');
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
    expect(inspectNativePhotoModuleTail(source, 'hot pot near me')).not.toBeNull();
  });
  it('retains exact-query, backward-scroll, ancestry and immediately adjacent merchant gates', () => {
    const source = original();
    expect(inspectNativePhotoModuleTail(source, 'pizza')).toBeNull();
    for (const modified of [source.replaceAll('ACTION_SCROLL_BACKWARD,', ''), source.replaceAll('id/content_container', 'id/not_content'),
      source.replaceAll(/content-desc="(?:Directions|Call|Menu|Reserve|Order)"/gu, 'content-desc="Unsupported action"')]) {
      expect(inspectNativePhotoModuleTail(modified, 'hot pot near me')).toBeNull();
    }
  });
});

// Existing fixtures/inline XML are synthetic, except the maps-26.41-* files:
// unmodified real Appium hierarchies from live captures on 2026-10-16.
// They validate observed search-layout variants, never semantic place/rank extraction.
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/android/${name}.xml`, import.meta.url), 'utf8');
const screen = (body: string, packageName = 'com.google.android.apps.maps'): string =>
  `<hierarchy><node class="android.widget.FrameLayout" package="${packageName}" displayed="true">${body}</node></hierarchy>`;
const search = (value: string, extra = ''): string =>
  `<node class="android.widget.EditText" resource-id="com.google.android.apps.maps:id/search_omnibox_edit_text" text="${value}" content-desc="Search here" enabled="true" ${extra}/>`;

describe('bounded native UI parsing', () => {
  it('preserves decoded text, descriptions, native attributes and bounds in document order', () => {
    const nodes = parseUiNodes(fixture('results-en'));
    expect(nodes[1]).toEqual({ text: 'seafood buffet', description: 'Search here', resourceId: 'com.google.android.apps.maps:id/search_omnibox_edit_text', className: 'android.widget.EditText', packageName: 'com.google.android.apps.maps', clickable: true, bounds: { left: 20, top: 50, right: 980, bottom: 160 } });
    expect(nodes.find((n) => n.text === 'SEE JOY & Seafood')?.resourceId).toBe('com.google.android.apps.maps:id/title');
    expect(nodes.some((n) => n.text === 'Ad')).toBe(false);
  });

  it('ignores invisible subtrees, preserves disabled evidence, and rejects inverted bounds', () => {
    const nodes = parseUiNodes(screen('<node displayed="false"><node text="Hidden"/></node><node class="android.widget.TextView" text="Visible" enabled="false" bounds="[50,10][20,30]"/>'));
    expect(nodes.map((n) => n.text)).toEqual(['', 'Visible']);
    expect(nodes[1]?.bounds).toBeNull();
  });

  it.each([
    '', '<hierarchy><node></hierarchy>', '<hierarchy/><hierarchy/>', '<html><body>Search results</body></html>',
    '<!DOCTYPE hierarchy [<!ENTITY secret SYSTEM "file:///etc/passwd">]><hierarchy><node text="&secret;"/></hierarchy>',
    '<!ENTITY x "hello"><hierarchy/>', '<hierarchy><node text="&unknown;"/></hierarchy>',
    '<hierarchy><node text="unescaped & text"/></hierarchy>', '<hierarchy><node text="&#0;"/></hierarchy>',
    '<hierarchy><node text="&#xD800;"/></hierarchy>', '<hierarchy><node text="<raw>"/></hierarchy>',
  ])('rejects malformed, non-native or unsafe XML: %s', (xml) => {
    expect(() => parseUiNodes(xml)).toThrow();
    expect(() => analyzeScreen(xml, 'seafood buffet')).toThrow();
  });

  it('accepts standard escaped characters without treating the text as markup', () => {
    expect(parseUiNodes(screen('<node text="Fish &amp; Chips &lt;Ad&gt; &#x1F41F;"/>'))[1]?.text).toBe('Fish & Chips <Ad> 🐟');
  });

  it('rejects oversized, deeply nested and excessive-node inputs', () => {
    for (const xml of [screen(`<node text="${'x'.repeat(2_100_000)}"/>`), `<hierarchy>${'<node>'.repeat(140)}${'</node>'.repeat(140)}</hierarchy>`, screen('<node/>'.repeat(10_001))]) {
      expect(() => parseUiNodes(xml)).toThrow();
    }
  });
});

describe('query identity from actual native search fields', () => {
  it('matches an exact normalized query in a Maps search field', () => {
    expect(analyzeScreen(screen(search('  SEAFOOD   BUFFET  ')), 'seafood buffet').queryVisible).toBe(true);
    expect(analyzeScreen(screen('<node class="android.widget.TextView" resource-id="com.google.android.apps.maps:id/search_omnibox_text_box" text="seafood buffet"/>'), 'seafood buffet').queryVisible).toBe(true);
    expect(analyzeScreen(screen('<node class="android.widget.EditText" content-desc="Search query: seafood buffet"/>'), 'seafood buffet').queryVisible).toBe(true);
  });

  it.each([
    '<node class="android.widget.TextView" text="seafood buffet"/>',
    '<node class="android.widget.EditText" text="seafood buffet" content-desc="Your name"/>',
    search('seafood buffet near me'), search('sushi'), search('seafood buffet', 'displayed="false"'),
    '<node class="android.widget.EditText" text="seafood buffet" content-desc="Search here" enabled="false"/>',
    '<node class="android.widget.TextView" resource-id="com.google.android.apps.maps:id/result_card" content-desc="Search query: seafood buffet"/>',
  ])('does not infer query identity from arbitrary, hidden, disabled or mismatched text', (body) => {
    expect(analyzeScreen(screen(body), 'seafood buffet').queryVisible).toBe(false);
  });

  it('rejects query evidence from an unrelated app and empty keywords', () => {
    const unrelated = analyzeScreen(screen(search('seafood buffet'), 'com.example.other'), 'seafood buffet');
    expect(unrelated.queryVisible).toBe(false);
    expect(unrelated.kind).toBe('unknown');
    expect(unrelated.warnings.length).toBeGreaterThan(0);
    expect(analyzeScreen(screen(search('')), '').queryVisible).toBe(false);
  });
});

describe('conservative screen evidence', () => {
  it.each([
    '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar" content-desc="Loading" displayed="true"/>',
    '<node package="com.google.android.apps.maps" class="android.widget.TextView" resource-id="com.google.android.apps.maps:id/loading_text" text="Loading results" displayed="true"/>',
  ])('requires review while visible loading evidence overlays otherwise recognized results', (loading) => {
    const source = fixture('results-en').replace('</hierarchy>', `${loading}</hierarchy>`);
    const analysis = analyzeScreen(source, 'seafood buffet');
    expect(analysis).toMatchObject({ kind: 'unknown', queryVisible: true });
    expect(analysis.warnings.join(' ')).toMatch(/loading/i);
  });

  it('ignores hidden progress indicators and a merchant named Loading', () => {
    const source = fixture('results-en').replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar" displayed="false"/><node package="com.google.android.apps.maps" class="android.widget.TextView" resource-id="com.google.android.apps.maps:id/title" text="Loading"/></hierarchy>');
    expect(analyzeScreen(source, 'seafood buffet').kind).toBe('results');
  });

  it.each([['blocked-en', 'blocked'], ['consent-en', 'consent']] as const)('preserves terminal %s evidence even with a visible loading indicator', (name, kind) => {
    const source = fixture(name).replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar" content-desc="Loading" displayed="true"/></hierarchy>');
    expect(analyzeScreen(source, 'seafood buffet').kind).toBe(kind);
  });

  it.each([
    ['results-en', 'results', true], ['detail-en', 'detail', false],
    ['no-results-en', 'no_results', true], ['blocked-en', 'blocked', false], ['consent-en', 'consent', false],
  ] as const)('recognizes explicit signals in %s', (name, kind, queryVisible) => {
    expect(analyzeScreen(fixture(name), 'seafood buffet')).toMatchObject({ kind, queryVisible });
  });

  it('retains duplicate visible text across illustrative scroll screens without inferring ranks', () => {
    const first = analyzeScreen(fixture('results-en'), 'seafood buffet');
    const next = analyzeScreen(fixture('results-scroll-en'), 'seafood buffet');
    expect(first.texts).toContain('SEE JOY & Seafood');
    expect(next.texts.filter((text) => text === 'SEE JOY & Seafood')).toHaveLength(2);
    expect(first.adLabels).toEqual(['Sponsored']);
    expect(next.adLabels).toEqual(['Ad']);
    expect(Object.keys(next).sort()).toEqual(['adLabels', 'kind', 'queryVisible', 'texts', 'warnings']);
    expect(next.warnings.join(' ')).toMatch(/rank/i);
  });

  it('reports visible explicit ad labels and never treats a merchant name as a label', () => {
    const result = analyzeScreen(screen('<node text="Sponsored Seafood"/><node text="Ad"/><node content-desc="Sponsored"/><node text="Ads" displayed="false"/>'), 'seafood buffet');
    expect(result.adLabels).toEqual(['Ad', 'Sponsored']);
    expect(result.kind).toBe('unknown');
    expect(result.warnings.join(' ')).toMatch(/advertis|ad labels/i);
  });

  it.each([
    '<node text="No results"/>', '<node text="No results found"/>',
    '<node text="Reviews: No results found here, try a different search"/>',
    '<node text="Verify you are human"/>', '<node text="Before you continue to Google"/>',
    '<node class="android.widget.Button" text="Directions" clickable="true"/>',
    '<node text="Search results"/>',
  ])('keeps isolated message, listing and partial-layout signals unknown', (body) => {
    expect(analyzeScreen(screen(search('seafood buffet') + body), 'seafood buffet').kind).toBe('unknown');
  });

  it('does not label a merchant named No results as an empty result set', () => {
    expect(analyzeScreen(fixture('results-en'), 'seafood buffet').kind).toBe('results');
  });

  it('does not accept a no-results message for a different query', () => {
    expect(analyzeScreen(fixture('no-results-en'), 'sushi')).toMatchObject({ kind: 'unknown', queryVisible: false });
  });

  it('does not promote results cues from another package', () => {
    expect(analyzeScreen(fixture('results-en').replaceAll('com.google.android.apps.maps', 'com.example.other'), 'seafood buffet')).toMatchObject({ kind: 'unknown', queryVisible: false });
  });
});

describe('real Google Maps 26.41 search panel compatibility', () => {
  const keyword = 'spicy duck neck flushing';

  it('accepts the inspected live panel and exact description-only query without inventing places or ranks', () => {
    const analysis = analyzeScreen(fixture('maps-26.41-search'), keyword);
    expect(analysis).toMatchObject({ kind: 'results', queryVisible: true });
    expect(analysis.texts).not.toContain('caoshi Duck Neck'); // Drawn in PNG; absent from the real hierarchy.
    expect(Object.keys(analysis).sort()).toEqual(['adLabels', 'kind', 'queryVisible', 'texts', 'warnings']);
    expect(analysis.warnings.join(' ')).toMatch(/screenshot capture.*26\.41/i);
    expect(analysis.warnings.join(' ')).toMatch(/semantic ranks.*not_evaluated/i);
    expect(analysis.warnings.join(' ')).not.toMatch(/live Google Maps layout compatibility is unverified/i);
  });

  it.each([
    ['list identity', 'id/search_list_layout', 'id/arbitrary_scrollable'],
    ['panel identity', 'id/content_container', 'id/unrelated_container'],
    ['slider identity', 'id/custom_slider_container', 'id/unrelated_slider'],
    ['close control', 'id/terra_navigation_header_close_button', 'id/other_close_button'],
    ['filter control', 'content-desc="More filters"', 'content-desc="Other filters"'],
    ['sort control', 'content-desc="Relevance"', 'content-desc="Other order"'],
    ['open filter', 'content-desc="Open now"', 'content-desc="Other hours"'],
    ['query heading', 'heading="true"', 'heading="false"'],
  ])('rejects the live-shaped panel without its %s', (_name, from, to) => {
    expect(analyzeScreen(fixture('maps-26.41-search').replaceAll(from, to), keyword)).toMatchObject({ kind: 'unknown' });
  });

  it('rejects a mismatched query and a foreign-app copy of the entire panel', () => {
    expect(analyzeScreen(fixture('maps-26.41-search'), 'sushi')).toMatchObject({ kind: 'unknown', queryVisible: false });
    expect(analyzeScreen(fixture('maps-26.41-search').replaceAll('com.google.android.apps.maps', 'com.example.other'), keyword))
      .toMatchObject({ kind: 'unknown', queryVisible: false });
  });

  it('does not borrow missing filters from elsewhere on screen', () => {
    const outside = `<node package="com.google.android.apps.maps" class="android.widget.Button" content-desc="More filters" enabled="true" clickable="true" bounds="[0,0][100,100]"/>`;
    const source = fixture('maps-26.41-search').replaceAll('content-desc="More filters"', 'content-desc="Other filters"')
      .replace('</hierarchy>', `${outside}</hierarchy>`);
    expect(analyzeScreen(source, keyword).kind).toBe('unknown');
  });

  it('does not count conflicting labels on one filter as two separate filters', () => {
    const source = fixture('maps-26.41-search').replaceAll('content-desc="Relevance"', 'content-desc="Other order"')
      .replace(/<[^>]*content-desc="More filters"[^>]*>/u, (tag) => tag.replace('text=""', 'text="Relevance"'));
    expect(analyzeScreen(source, keyword).kind).toBe('unknown');
  });

  it('accepts the second real panel with an explicit Sponsored label and a different action set', () => {
    const analysis = analyzeScreen(fixture('maps-26.41-sponsored-search'), 'hot pot near me');
    expect(analysis).toMatchObject({ kind: 'results', queryVisible: true, adLabels: ['Sponsored'] });
    expect(analysis.texts).not.toContain('KPOT Korean BBQ & Hot Pot');
    expect(analysis.warnings.join(' ')).toMatch(/advertisement coverage is not evaluated/i);
  });

  it('accepts the real Koreatown panel with labels on direct children of clickable filter parents', () => {
    const analysis = analyzeScreen(fixture('maps-26.41-koreatown-search'), 'Koreatown hot pot');
    expect(analysis).toMatchObject({ kind: 'results', queryVisible: true, adLabels: ['Sponsored'] });
    expect(analysis.warnings.join(' ')).toMatch(/screenshot capture.*26\.41/i);
    expect(analysis.warnings.join(' ')).toMatch(/semantic ranks.*not_evaluated/i);
    expect(analysis.warnings.join(' ')).not.toMatch(/synthetic fixtures/i);
  });

  it.each([
    ['not clickable', 'clickable="true"', 'clickable="false"'],
    ['disabled', 'enabled="true"', 'enabled="false"'],
    ['foreign-owned', 'package="com.google.android.apps.maps"', 'package="com.example.other"'],
    ['unobserved class', 'class="android.widget.FrameLayout"', 'class="android.widget.LinearLayout"'],
    ['labeled differently', 'text=""', 'text="Other order"'],
  ])('rejects child filter labels when their parent is %s', (_name, from, to) => {
    const original = fixture('maps-26.41-koreatown-search');
    const source = original.replace(/<android\.widget\.FrameLayout[^>]*>\s*<android\.widget\.Button[^>]*text="Relevance"[^>]*\/>\s*<\/android\.widget\.FrameLayout>/u,
      (group) => group.replace(/^[^>]*>/u, (parent) => parent.replace(from, to)));
    expect(source).not.toBe(original);
    expect(analyzeScreen(source, 'Koreatown hot pot').kind).toBe('unknown');
  });

  it('requires an unambiguous filter child with the exact parent bounds and no intervening wrapper', () => {
    const original = fixture('maps-26.41-koreatown-search');
    const changeChild = (transform: (tag: string) => string): string =>
      original.replace(/<android\.widget\.Button[^>]*text="Relevance"[^>]*\/>/u, transform);
    for (const source of [
      changeChild((tag) => tag.replace('bounds="[112,456][329,552]"', 'bounds="[0,0][100,100]"')),
      changeChild((tag) => tag.replace('text="Relevance"', 'text="Open now"')),
      changeChild((tag) => `<node class="android.widget.LinearLayout">${tag}</node>`),
      changeChild((tag) => tag + tag),
    ]) {
      expect(source).not.toBe(original);
      expect(analyzeScreen(source, 'Koreatown hot pot').kind).toBe('unknown');
    }
  });

  it('requires at least two distinct enabled actions together inside the result list', () => {
    const source = fixture('maps-26.41-search').replaceAll('content-desc="Call"', 'content-desc="Other call"')
      .replaceAll('content-desc="Share"', 'content-desc="Other share"').replaceAll('content-desc="Save"', 'content-desc="Other save"');
    expect(analyzeScreen(source, keyword).kind).toBe('unknown');
    const oneControlWithTwoLabels = source.replace(/<[^>]*content-desc="Directions"[^>]*>/u,
      (tag) => tag.replace('text=""', 'text="Call"'));
    expect(analyzeScreen(oneControlWithTwoLabels, keyword).kind).toBe('unknown');
    const outside = '<node package="com.google.android.apps.maps" class="android.widget.Button" content-desc="Call" clickable="true" bounds="[0,0][100,100]"/>';
    expect(analyzeScreen(source.replace('</hierarchy>', `${outside}</hierarchy>`), keyword).kind).toBe('unknown');
  });

  it.each([
    ['disabled', 'enabled="true"', 'enabled="false"'],
    ['hidden', 'displayed="true"', 'displayed="false"'],
    ['not scrollable', 'scrollable="true"', 'scrollable="false"'],
    ['foreign-owned', 'package="com.google.android.apps.maps"', 'package="com.example.other"'],
  ])('rejects a %s list even when its descendants retain their Maps attributes', (_name, from, to) => {
    const source = fixture('maps-26.41-search').replace(/<[^>]*resource-id="com\.google\.android\.apps\.maps:id\/search_list_layout"[^>]*>/u,
      (tag) => tag.replace(from, to));
    expect(analyzeScreen(source, keyword).kind).toBe('unknown');
  });

  it('preserves loading and blocking guards over the real panel', () => {
    const source = fixture('maps-26.41-search');
    const loading = source.replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar"/></hierarchy>');
    const loadingAnalysis = analyzeScreen(loading, keyword);
    expect(loadingAnalysis).toMatchObject({ kind: 'unknown', queryVisible: true });
    expect(loadingAnalysis.warnings.join(' ')).toMatch(/loading indicator/i);
    expect(loadingAnalysis.warnings.join(' ')).toMatch(/26\.41/i);
    expect(loadingAnalysis.warnings.join(' ')).not.toMatch(/synthetic fixtures/i);
    const challenge = source.replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.app.Dialog"><node text="Verify you are human"/><node text="Verify" clickable="true"/></node></hierarchy>');
    expect(analyzeScreen(challenge, keyword).kind).toBe('blocked');
    const detail = source.replace('</hierarchy>', '<node package="com.google.android.apps.maps"><node resource-id="com.google.android.apps.maps:id/place_title" text="A place"/><node text="Overview" clickable="true"/><node text="Reviews" clickable="true"/></node></hierarchy>');
    expect(analyzeScreen(detail, keyword).kind).toBe('unknown');
  });
});


describe('observed Maps 26.41 photo discovery search', () => {
  const keyword = 'spicy duck neck flushing';
  const original = (): string => fixture('maps-26.41-photo-discovery');
  it('preserves photo discovery as unranked evidence instead of inventing a list or detail classification', () => {
    const analysis = analyzeScreen(original(), keyword);
    expect(analysis).toMatchObject({ kind: 'photo_discovery', queryVisible: true });
    expect(analysis.warnings.join(' ')).toMatch(/photo discovery/i);
    expect(analysis.warnings.join(' ')).toMatch(/rank.*not_evaluated/i);
    expect(Object.keys(analysis).sort()).toEqual(['adLabels', 'kind', 'queryVisible', 'texts', 'warnings']);
  });
  it('does not accept another query or missing query-specific photo descriptions', () => {
    expect(analyzeScreen(original(), 'duck neck').kind).toBe('unknown');
    expect(analyzeScreen(original().replaceAll('Image result for spicy duck neck flushing', 'Image result for another query'), keyword).kind).toBe('unknown');
    expect(analyzeScreen(original().replaceAll(/content-desc="Image result for [^"]+"/g, 'content-desc=""'), keyword).kind).toBe('unknown');
  });
  it('requires the photo gallery and action rows to remain inside the observed native result panel', () => {
    for (const source of [
      original().replaceAll('id/search_list_layout', 'id/other_list'),
      original().replaceAll('id/content_container', 'id/other_container'),
      original().replaceAll('id/custom_slider_container', 'id/other_slider'),
      original().replaceAll('content-desc="Directions"', 'content-desc="Other directions"'),
      original().replaceAll('content-desc="Order"', 'content-desc="Other order"').replaceAll('content-desc="Menu"', 'content-desc="Other menu"'),
      original().replace(/<android\.widget\.HorizontalScrollView[^>]*bounds="\[0,1171\]\[720,1232\]"[^>]*>/, tag => tag.replace('package="com.google.android.apps.maps"', 'package="com.example.other"')),
    ]) {
      expect(source).not.toBe(original());
      expect(analyzeScreen(source, keyword).kind).toBe('unknown');
    }
  });
  it.each([
    ['disabled', 'enabled="true"', 'enabled="false"'],
    ['hidden', 'displayed="true"', 'displayed="false"'],
    ['not scrollable', 'scrollable="true"', 'scrollable="false"'],
    ['foreign-owned', 'package="com.google.android.apps.maps"', 'package="com.example.other"'],
  ])('rejects a %s photo panel even when child labels look valid', (_name, from, to) => {
    const source = original().replace(/<[^>]*resource-id="com\.google\.android\.apps\.maps:id\/search_list_layout"[^>]*>/u, tag => tag.replace(from, to));
    expect(analyzeScreen(source, keyword).kind).toBe('unknown');
  });
  it('preserves loading, challenge, consent and other-package protections', () => {
    expect(analyzeScreen(original().replaceAll('com.google.android.apps.maps', 'com.example.other'), keyword).kind).toBe('unknown');
    const loading = original().replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar"/></hierarchy>');
    expect(analyzeScreen(loading, keyword).kind).toBe('unknown');
    const challenge = original().replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.app.Dialog"><node text="Verify you are human"/><node text="Verify" clickable="true"/></node></hierarchy>');
    expect(analyzeScreen(challenge, keyword).kind).toBe('blocked');
    const consent = original().replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.app.Dialog"><node text="Before you continue to Google"/><node text="Privacy"/><node text="Accept all" clickable="true"/></node></hierarchy>');
    expect(analyzeScreen(consent, keyword).kind).toBe('consent');
  });
});


describe('observed Maps 26.41 scrolled native result body', () => {
  const original = (): string => fixture('ranking/05-scroll-1');
  it('recognizes the exact result query after the horizontal filter row scrolls offscreen', () => {
    expect(original()).not.toContain('text="Relevance"');
    expect(analyzeScreen(original(), 'hot pot near me')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(analyzeScreen(fixture('ranking/05-scroll-4'), 'hot pot near me').kind).toBe('results');
  });
  it('rejects a different query, unsupported ancestry and map-only layout', () => {
    expect(analyzeScreen(original(), 'hot pot').kind).toBe('unknown');
    for (const source of [
      original().replaceAll('id/content_container', 'id/other_container'),
      original().replaceAll('id/custom_slider_container', 'id/other_slider'),
      original().replaceAll('id/search_list_layout', 'id/map_view'),
      original().replaceAll('actions="ACTION_FOCUS,ACTION_SELECT,ACTION_CLEAR_SELECTION,ACTION_ACCESSIBILITY_FOCUS,ACTION_SCROLL_FORWARD,ACTION_SCROLL_BACKWARD,ACTION_SHOW_ON_SCREEN,ACTION_SCROLL_TO_POSITION"', 'actions=""'),
    ]) expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
  it('requires enabled visible direct card children and action rows inside those cards', () => {
    for (const source of [
      original().replaceAll('class="android.widget.FrameLayout"', 'class="android.widget.LinearLayout"'),
      original().replaceAll('content-desc="Directions"', 'content-desc="Other direction"').replaceAll('content-desc="Call"', 'content-desc="Other call"').replaceAll('content-desc="Share"', 'content-desc="Other share"').replaceAll('content-desc="Save"', 'content-desc="Other save"'),
      original().replace(/<android\.support\.v7\.widget\.RecyclerView[^>]*resource-id="com\.google\.android\.apps\.maps:id\/search_list_layout"[^>]*>/u, tag => tag.replace('enabled="true"', 'enabled="false"')),
    ]) expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
  it('keeps loading and interaction overlays out of accepted scrolled result evidence', () => {
    const source = original();
    expect(analyzeScreen(source.replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.widget.ProgressBar"/></hierarchy>'), 'hot pot near me').kind).toBe('unknown');
    expect(analyzeScreen(source.replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.app.Dialog"><node text="Verify you are human"/><node text="Verify" clickable="true"/></node></hierarchy>'), 'hot pot near me').kind).toBe('blocked');
  });
});


describe('observed tall Sponsored card before native sheet expansion', () => {
  const original = (): string => fixture('native-scroll-tall-sponsored');
  it('accepts the clipped first sponsored card when its native action row is below the viewport', () => {
    expect(original()).not.toContain('content-desc="Directions"');
    expect(analyzeScreen(original(), 'hot pot near me')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({
      bounds: { left: 0, top: 456, right: 720, bottom: 1232 }, canScrollBackward: false, canScrollForward: true,
      sheetHandleBounds: { left: 320, top: 352, right: 400, bottom: 360 }, expansionTargetY: 160,
    });
  });
  it('rejects wrong queries and requires both same-card ad controls with the observed filters', () => {
    expect(analyzeScreen(original(), 'hot pot').kind).toBe('unknown');
    for (const source of [
      original().replaceAll('content-desc="Sponsored"', 'content-desc=""'),
      original().replaceAll('content-desc="About this ad"', 'content-desc=""'),
      original().replaceAll('content-desc="Sponsored"', 'content-desc=""').replaceAll('content-desc="About this ad"', 'content-desc=""'),
      original().replaceAll('text="Relevance"', 'text="Other"').replaceAll('content-desc="Relevance"', 'content-desc="Other"'),
      original().replaceAll('id/content_container', 'id/other_container'),
      original().replaceAll('id/custom_slider_container', 'id/other_slider'),
      original().replaceAll('id/search_list_layout', 'id/other_list'),
      original().replaceAll(/ actions="[^"]*"/gu, ''),
    ]) {
      expect(source).not.toBe(original());
      expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
    }
  });
  it.each([
    ['disabled', 'enabled="true"', 'enabled="false"'],
    ['hidden', 'displayed="true"', 'displayed="false"'],
    ['foreign', 'package="com.google.android.apps.maps"', 'package="com.example.other"'],
    ['not clickable', 'clickable="true"', 'clickable="false"'],
    ['outside card bounds', 'bounds="[166,568][202,604]"', 'bounds="[166,100][202,136]"'],
  ])('rejects an About this ad control that is %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*content-desc="About this ad"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
  it('does not reuse an ad label from outside the card or turn photo discovery into results', () => {
    const moved = original().replace('content-desc="About this ad"', 'content-desc=""')
      .replace('</hierarchy>', '<node package="com.google.android.apps.maps" class="android.view.ViewGroup" content-desc="About this ad" enabled="true" clickable="true" bounds="[166,568][202,604]"/></hierarchy>');
    expect(analyzeScreen(moved, 'hot pot near me').kind).toBe('unknown');
    expect(analyzeScreen(fixture('maps-26.41-photo-discovery'), 'spicy duck neck flushing').kind).toBe('photo_discovery');
  });
});


describe('embedded photo module in a proven scrolled result list', () => {
  const original = (): string => fixture('ranking/trial-photo-module');
  const moduleOnly = (): string => {
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(original());
    const keepModule = (entries: Record<string, any>[]): void => {
      for (const entry of entries) for (const [key, value] of Object.entries(entry)) {
        if (!Array.isArray(value)) continue;
        if (entry[':@']?.['resource-id'] === 'com.google.android.apps.maps:id/search_list_layout') {
          entry[key] = value.filter(child => child[':@']?.bounds === '[0,1088][720,1232]');
        } else keepModule(value);
      }
    };
    keepModule(tree);
    return new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' }).build(tree);
  };
  it('accepts the actual merchant plus photo-module frame as a scrolled list continuation', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({ canScrollBackward: true });
  });
  it('accepts a module-only viewport with at least one explicit query-specific native image anchor', () => {
    const source = moduleOnly().replace('content-desc="Image result for hot pot near me posted by Mila"', 'content-desc=""');
    expect(source).not.toContain('content-desc="Directions"');
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(source, 'hot pot near me')).toMatchObject({ canScrollBackward: true });
  });
  it('does not fall back to merchant heuristics for a mixed module with a different query', () => {
    const source = original().replaceAll('Image result for hot pot near me posted by', 'Image result for other query posted by');
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
  it('requires backward-scroll evidence and preserves initial photo-discovery classification', () => {
    expect(analyzeScreen(original().replaceAll(',ACTION_SCROLL_BACKWARD', ''), 'hot pot near me').kind).not.toBe('results');
    expect(analyzeScreen(moduleOnly().replaceAll(',ACTION_SCROLL_BACKWARD', ''), 'hot pot near me').kind).toBe('unknown');
    expect(analyzeScreen(fixture('maps-26.41-photo-discovery'), 'spicy duck neck flushing').kind).toBe('photo_discovery');
  });
  it('rejects wrong query, missing image evidence, bad grid ancestry and merchant metadata inside the module', () => {
    expect(analyzeScreen(moduleOnly(), 'other query').kind).toBe('unknown');
    for (const source of [
      moduleOnly().replaceAll('Image result for hot pot near me posted by', 'Image result for other query posted by'),
      moduleOnly().replaceAll(/content-desc="Image result for [^"]+"/gu, 'content-desc=""'),
      moduleOnly().replaceAll('class="android.widget.HorizontalScrollView"', 'class="android.widget.ScrollView"'),
      moduleOnly().replace('content-desc="Image result for hot pot near me posted by Mila"', 'content-desc="Sponsored"'),
      moduleOnly().replace('content-desc="Image result for hot pot near me posted by Mila"', 'content-desc="Directions"'),
      moduleOnly().replaceAll('id/content_container', 'id/other_container'),
    ]) expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
  it.each([
    ['disabled', 'enabled="true"', 'enabled="false"'],
    ['hidden', 'displayed="true"', 'displayed="false"'],
    ['foreign', 'package="com.google.android.apps.maps"', 'package="com.example.other"'],
    ['not scrollable', 'scrollable="true"', 'scrollable="false"'],
  ])('rejects a module grid that is %s', (_name, from, to) => {
    const original = moduleOnly();
    const source = original.replace(/<android\.widget\.HorizontalScrollView[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original);
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('unknown');
  });
});

describe('observed first organic result followed by an embedded photo module', () => {
  const original = (): string => fixture('ranking/initial-organic-photo-module');
  it('accepts the actual filtered list top without treating its embedded module as standalone photo discovery', () => {
    expect(analyzeScreen(original(), 'hot pot near me')).toMatchObject({ kind: 'results', queryVisible: true, adLabels: [] });
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({
      canScrollBackward: false, canScrollForward: true, bounds: { left: 0, top: 272, right: 720, bottom: 1232 },
    });
  });
  it.each([
    ['no top scroll proof', ',ACTION_SCROLL_TO_POSITION', ''],
    ['no forward scroll proof', ',ACTION_SCROLL_FORWARD', ''],
    ['missing filters', 'content-desc="More filters"', 'content-desc="Other filters"'],
    ['wrong photo query', 'Image result for hot pot near me', 'Image result for another query'],
    ['conflicting module metadata', 'content-desc="Image result for hot pot near me posted by Mila"', 'content-desc="Sponsored"'],
    ['missing merchant actions', 'content-desc="Directions"', 'content-desc="Other direction"'],
    ['wrong panel ancestry', 'id/content_container', 'id/other_container'],
    ['overlapping cards', '[0,1057][720,1232]', '[0,1000][720,1232]'],
    ['filter row not at list top', '[0,272][720,368]', '[0,278][720,368]'],
  ])('does not accept a ranked list when %s', (_label, from, to) => {
    const source = original().replaceAll(from, to);
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
    expect(inspectNativeResultList(source, 'hot pot near me')).toBeNull();
  });
  it('keeps the earlier standalone photo discovery fixture unranked and requires the exact query', () => {
    expect(analyzeScreen(fixture('maps-26.41-photo-discovery'), 'spicy duck neck flushing').kind).toBe('photo_discovery');
    expect(analyzeScreen(original(), 'hot pot').kind).toBe('unknown');
  });
});


describe('initial merchant and clipped photo module with wrapped native filter labels', () => {
  const original = (): string => fixture('ranking/initial-organic-photo-module-wrapped-filters');
  it('recognizes the actual Flushing list top using the strict same-bounds filter wrapper', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')?.canScrollBackward).toBe(false);
  });
  it.each([
    ['nonclickable wrapper', 'clickable="true"', 'clickable="false"'],
    ['wrong wrapper class', 'class="android.widget.FrameLayout"', 'class="android.view.ViewGroup"'],
    ['labeled wrapper conflict', 'text=""', 'text="Unrelated control"'],
  ])('rejects %s', (_name, from, to) => {
    const source = original().replace(/<android\.widget\.FrameLayout[^>]*bounds="\[112,272\]\[329,368\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['different button bounds', 'bounds="[112,272][329,368]"', 'bounds="[113,272][329,368]"'],
    ['wrong child class', 'class="android.widget.Button"', 'class="android.widget.TextView"'],
    ['disabled child', 'enabled="true"', 'enabled="false"'],
  ])('rejects %s', (_name, from, to) => {
    const source = original().replace(/<android\.widget\.Button[^>]*bounds="\[112,272\]\[329,368\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('also accepts an independently clickable labeled button as the existing direct-control variant', () => {
    const source = original().replace(/<android\.widget\.Button[^>]*bounds="\[112,272\]\[329,368\]"[^>]*>/u, tag => tag.replace('clickable="false"', 'clickable="true"'));
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
  });
  it('rejects borrowing a label from a wrapper with multiple direct children', () => {
    const source = original().replace(/(<android\.widget\.FrameLayout[^>]*bounds="\[112,272\]\[329,368\]"[^>]*>)/u,
      '$1<android.view.View class="android.view.View" package="com.google.android.apps.maps" enabled="true" bounds="[112,272][329,368]"/>');
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('does not infer merchant-list proof from wrong query images or absent native top evidence', () => {
    expect(analyzeScreen(original().replaceAll('Image result for hot pot near me posted by', 'Image result for other query posted by'), 'hot pot near me').kind).not.toBe('results');
    expect(analyzeScreen(original().replaceAll(',ACTION_SCROLL_TO_POSITION', ''), 'hot pot near me').kind).not.toBe('results');
  });
});

describe('observed clipped card footer before merchant and photo-module continuation', () => {
  const original = (): string => fixture('native-scroll-module-footer20');
  it.each(['native-scroll-module-footer20', 'native-scroll-module-footer7'])('accepts the real bounded leading footer in %s without changing list-top proof', name => {
    const source = fixture(name);
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(source, 'hot pot near me')).toMatchObject({ canScrollBackward: true, bounds: { left: 0, top: 274, right: 720, bottom: 1232 } });
  });
  it('counts Reserve and Order as merchant actions in the strict module continuation', () => {
    const source = original().replaceAll('content-desc="Menu"', 'content-desc=""');
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
  });
  it.each([
    ['oversized', '[0,274][720,294]', '[0,274][720,307]'],
    ['inside the list rather than at its leading edge', '[0,274][720,294]', '[0,280][720,300]'],
    ['without backward proof', ',ACTION_SCROLL_BACKWARD', ''],
  ])('rejects the footer continuation when %s', (_name, from, to) => {
    expect(analyzeScreen(original().replaceAll(from, to), 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects multiple empty footer fragments instead of treating them as merchants', () => {
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(original());
    const duplicateFooter = (entries: Record<string, any>[]): void => {
      for (const entry of entries) for (const [key, value] of Object.entries(entry)) {
        if (!Array.isArray(value)) continue;
        if (entry[':@']?.['resource-id'] === 'com.google.android.apps.maps:id/search_list_layout') {
          entry[key] = [value[0], structuredClone(value[0]), ...value.slice(1)];
        } else duplicateFooter(value);
      }
    };
    duplicateFooter(tree);
    const source = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' }).build(tree);
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('requires a recognized merchant card alongside the module and footer', () => {
    const source = original().replaceAll(/content-desc="(?:Directions|Reserve|Order|Menu)"/gu, 'content-desc=""');
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});


describe('observed native photo-module map control', () => {
  const original = (): string => fixture('ranking/native-photo-map-button');
  it('accepts the exact native map control below a proven query-photo grid', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({ canScrollBackward: true });
  });
  it.each([
    ['above the photo-grid bottom', 'bounds="[40,1169][680,1232]"', 'bounds="[40,500][680,563]"'],
    ['wrong native class', 'class="android.view.ViewGroup"', 'class="android.widget.Button"'],
    ['not clickable', 'clickable="true"', 'clickable="false"'],
    ['missing click action', ',ACTION_CLICK', ''],
    ['wrong label', 'content-desc="View photo map"', 'content-desc="View map"'],
  ])('rejects a photo map control with %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*content-desc="View photo map"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('requires the photos to prove the exact query and never accepts the button alone', () => {
    for (const source of [
      original().replaceAll('Image result for hot pot near me posted by', 'Image result for other query posted by'),
      original().replaceAll(/content-desc="Image result for [^"]+"/gu, 'content-desc=""'),
    ]) expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});


describe('observed photo module with a trailing clipped card header', () => {
  const original = (): string => fixture('ranking/native-photo-map-only-edge');
  it('accepts the actual module-only viewport and its 5px trailing empty native card sliver', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({ canScrollBackward: true });
  });
  it.each([
    ['overlapping the preceding module', '[0,1227][720,1232]', '[0,1199][720,1232]'],
    ['interior', '[0,1227][720,1232]', '[0,1221][720,1226]'],
    ['no backward proof', ',ACTION_SCROLL_BACKWARD', ''],
  ])('rejects a trailing fragment that is %s', (_name, from, to) => {
    expect(analyzeScreen(original().replaceAll(from, to), 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects multiple trailing slivers instead of fabricating merchant evidence', () => {
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(original());
    const duplicate = (entries: Record<string, any>[]): void => {
      for (const entry of entries) for (const [key, value] of Object.entries(entry)) {
        if (!Array.isArray(value)) continue;
        if (entry[':@']?.['resource-id'] === 'com.google.android.apps.maps:id/search_list_layout') entry[key] = [...value, structuredClone(value.at(-1))];
        else duplicate(value);
      }
    };
    duplicate(tree);
    const source = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' }).build(tree);
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});

describe('observed photo module with only a leading clipped merchant footer', () => {
  const original = (): string => fixture('ranking/native-photo-module-leading-footer');
  it('accepts the actual 7px footer followed by the sole exact-query photo module', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')).toMatchObject({ canScrollBackward: true, canScrollForward: true });
  });
  it.each([
    ['oversized footer', '[0,274][720,281]', '[0,274][720,307]'],
    ['interior fragment', '[0,274][720,281]', '[0,280][720,287]'],
    ['no backward proof', ',ACTION_SCROLL_BACKWARD', ''],
    ['wrong query photos', 'Image result for hot pot near me posted by', 'Image result for other query posted by'],
    ['wrong query-panel lineage', 'id/content_container', 'id/other_container'],
  ])('rejects the module-only leading footer with %s', (_name, from, to) => {
    expect(analyzeScreen(original().replaceAll(from, to), 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects a malformed empty footer body', () => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[0,274\]\[720,281\]"[^>]*>/u,
      tag => tag.replace('clickable="true"', 'clickable="false"'));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects more than one leading fragment', () => {
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(original());
    const duplicate = (entries: Record<string, any>[]): void => {
      for (const entry of entries) for (const [key, value] of Object.entries(entry)) {
        if (!Array.isArray(value)) continue;
        if (entry[':@']?.['resource-id'] === 'com.google.android.apps.maps:id/search_list_layout') entry[key] = [value[0], structuredClone(value[0]), ...value.slice(1)];
        else duplicate(value);
      }
    };
    duplicate(tree);
    const source = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' }).build(tree);
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});

describe('structural trailing native placeholder after a photo module', () => {
  const original = (): string => fixture('ranking/native-photo-module-trailing-header');
  it('accepts the actual 51px incomplete header after the module', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
  });
  it.each([
    ['interior', '[0,1181][720,1232]', '[0,1180][720,1231]'],
    ['overlapping its preceding module', '[0,1181][720,1232]', '[0,1150][720,1232]'],
    ['no forward scroll proof', ',ACTION_SCROLL_FORWARD', ''],
    ['no backward scroll proof', ',ACTION_SCROLL_BACKWARD', ''],
    ['wrong query photos', 'Image result for hot pot near me posted by', 'Image result for other query posted by'],
    ['wrong panel lineage', 'id/content_container', 'id/other_container'],
  ])('rejects a trailing placeholder with %s', (_name, from, to) => {
    expect(analyzeScreen(original().replaceAll(from, to), 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['metadata', 'text=""', 'text="Unproven merchant"'],
    ['no click action', ',ACTION_CLICK', ''],
    ['scrollable body', 'scrollable="false"', 'scrollable="true"'],
    ['wrong wrapper class', 'class="android.view.ViewGroup"', 'class="android.widget.FrameLayout"'],
  ])('rejects a trailing native body with %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[0,1181\]\[720,1232\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects reversed card order and an extra unresolved sibling', () => {
    for (const reverse of [true, false]) {
      const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false }).parse(original());
      const change = (entries: Record<string, any>[]): void => {
        for (const entry of entries) for (const [key, value] of Object.entries(entry)) {
          if (!Array.isArray(value)) continue;
          if (entry[':@']?.['resource-id'] === 'com.google.android.apps.maps:id/search_list_layout') entry[key] = reverse ? [...value].reverse() : [...value, structuredClone(value.at(-1))];
          else change(value);
        }
      };
      change(tree);
      expect(analyzeScreen(new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '' }).build(tree), 'hot pot near me').kind).not.toBe('results');
    }
  });
});

describe('observed photo module followed by a populated clipped merchant header', () => {
  const original = (): string => fixture('ranking/native-photo-module-populated-header');
  it('accepts the actual module tail and next card header without inventing list-top evidence', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')?.canScrollBackward).toBe(true);
  });
  it('permits a narrow right-edge photo tile without treating its width as vertical clipping proof', () => {
    expect(analyzeScreen(original().replaceAll('[640,1198][720,1232]', '[700,1198][720,1232]'), 'hot pot near me').kind).toBe('results');
  });
  it.each([
    ['no forward proof', ',ACTION_SCROLL_FORWARD', ''],
    ['no backward proof', ',ACTION_SCROLL_BACKWARD', ''],
    ['wrong query photo anchors', 'Image result for hot pot near me posted by', 'Image result for other query posted by'],
    ['wrong panel lineage', 'id/content_container', 'id/other_container'],
    ['interior card', '[0,1030][720,1232]', '[0,1030][720,1231]'],
    ['overlapping card', '[0,1030][720,1232]', '[0,1010][720,1232]'],
    ['unexpected merchant label', 'content-desc="Wheelchair accessible"', 'content-desc="Unproven merchant"'],
    ['conflicting ad metadata', 'content-desc="Wheelchair accessible"', 'content-desc="Sponsored"'],
    ['action row instead of photo strip', 'content-desc="Wheelchair accessible"', 'content-desc="Directions"'],
  ])('rejects a populated continuation with %s', (_name, from, to) => {
    const source = original().replaceAll(from, to);
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['clickless card body', 'clickable="true"', 'clickable="false"'],
    ['scrolling card body', 'scrollable="false"', 'scrollable="true"'],
    ['wrong card body class', 'class="android.view.ViewGroup"', 'class="android.widget.FrameLayout"'],
  ])('rejects %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[0,1030\]\[720,1232\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['wrong metadata class', 'class="android.view.ViewGroup"', 'class="android.widget.TextView"'],
    ['clickable metadata', 'clickable="false"', 'clickable="true"'],
    ['unbounded metadata', 'bounds="[40,1102][178,1142]"', 'bounds="[40,1102][178,1250]"'],
  ])('rejects %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[40,1102\]\[178,1142\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects photo tiles from a different application or outside the clipped strip', () => {
    for (const [from, to] of [
      ['package="com.google.android.apps.maps"', 'package="com.example.other"'],
      ['bounds="[40,1198][324,1232]"', 'bounds="[40,1198][324,1250]"'],
    ]) {
      const source = original().replace(/<android\.widget\.ImageView[^>]*bounds="\[40,1198\]\[324,1232\]"[^>]*>/u, tag => tag.replace(from!, to!));
      expect(source).not.toBe(original());
      expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
    }
  });
});

describe('observed populated continuation before its quote footer enters the viewport', () => {
  const original = (): string => fixture('ranking/native-photo-module-populated-header-padding');
  it('accepts the actual 4px blank padding below the photo strip', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')?.canScrollBackward).toBe(true);
  });
  it.each([0, 1, 8, 15, 16])('accepts %ipx of bounded unoccupied padding before a footer appears', gap => {
    const source = original().replaceAll('1228]', `${1232 - gap}]`);
    expect(analyzeScreen(source, 'hot pot near me').kind).toBe('results');
  });
  it.each([17, 32, 100])('rejects an unoccupied %ipx gap beyond the observed native footer spacing', gap => {
    const source = original().replaceAll('1228]', `${1232 - gap}]`);
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('still rejects missing backward proof and query-mismatched modules', () => {
    expect(analyzeScreen(original().replaceAll(',ACTION_SCROLL_BACKWARD', ''), 'hot pot near me').kind).not.toBe('results');
    expect(analyzeScreen(original().replaceAll('Image result for hot pot near me posted by', 'Image result for other query posted by'), 'hot pot near me').kind).not.toBe('results');
  });
});

describe('observed populated continuation with a clipped empty quote footer', () => {
  const original = (): string => fixture('ranking/native-photo-module-populated-header-footer');
  it('accepts the native photo strip followed by its small empty bottom-clipped footer', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativeResultList(original(), 'hot pot near me')?.canScrollBackward).toBe(true);
  });
  it.each([
    ['labeled footer', 'text=""', 'text="Unproven metadata"'],
    ['clickable footer', 'clickable="false"', 'clickable="true"'],
    ['scrollable footer', 'scrollable="false"', 'scrollable="true"'],
    ['oversized footer', 'bounds="[40,1223][680,1232]"', 'bounds="[40,1199][680,1232]"'],
    ['unbounded gap', 'bounds="[40,1223][680,1232]"', 'bounds="[40,1224][680,1232]"'],
    ['wrong footer class', 'class="android.view.ViewGroup"', 'class="android.widget.ImageView"'],
  ])('rejects %s', (_name, from, to) => {
    const source = original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[40,1223\]\[680,1232\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects extra nested footer contents rather than concealing unresolved controls', () => {
    const source = original().replace(/(<android\.view\.ViewGroup[^>]*bounds="\[40,1223\]\[680,1232\]"[^>]*)\/>/u,
      '$1><android.view.ViewGroup class="android.view.ViewGroup" package="com.google.android.apps.maps" enabled="true" bounds="[40,1223][680,1232]"/></android.view.ViewGroup>');
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});

describe('native quote and module-tail continuation structures', () => {
  it.each([
    ['native-photo-module-quote-footer', 'hot pot near me'],
    ['native-photo-module-control-tail', 'hot pot near me'],
    ['native-photo-module-quote-footer-duck', 'spicy duck neck flushing'],
  ])('recognizes actual continuing list %s without claiming top-of-list', (name, keyword) => {
    expect(analyzeScreen(fixture(`ranking/${name}`), keyword).kind).toBe('results');
    expect(inspectNativeResultList(fixture(`ranking/${name}`), keyword)?.canScrollBackward).toBe(true);
  });
  it.each([
    ['clickable quote', 'clickable="false"', 'clickable="true"'],
    ['labeled quote', 'text=""', 'text="Unknown action"'],
    ['scrollable quote', 'scrollable="false"', 'scrollable="true"'],
    ['overlapping quote', 'bounds="[40,1131][680,1208]"', 'bounds="[40,1100][680,1208]"'],
  ])('rejects %s', (_name, from, to) => {
    const source = fixture('ranking/native-photo-module-quote-footer').replace(/<android\.view\.ViewGroup[^>]*bounds="\[40,1131\]\[680,1208\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(fixture('ranking/native-photo-module-quote-footer'));
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['no backwards proof', ',ACTION_SCROLL_BACKWARD', ''],
    ['no proven merchant action row', 'content-desc="Directions"', 'content-desc="Unknown action"'],
  ])('rejects a module tail with %s', (_name, from, to) => {
    let source = fixture('ranking/native-photo-module-control-tail').replaceAll(from, to);
    if (_name === 'no proven merchant action row') source = source.replaceAll(/content-desc="(?:Order|Menu|Call)"/gu, 'content-desc=""');
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('rejects a module tail away from the top clipped edge', () => {
    const source = fixture('ranking/native-photo-module-control-tail').replaceAll('[0,274][720,409]', '[0,275][720,409]');
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
  it('never excludes a differently labeled control as a photo module tail', () => {
    const source = fixture('ranking/native-photo-module-control-tail').replace('content-desc="View photo map"', 'content-desc="View map"');
    expect(inspectNativePhotoModuleTail(source, 'hot pot near me')).toBeNull();
  });
  it('rejects a populated trailing header away from the bottom clipped edge', () => {
    const source = fixture('ranking/native-photo-module-control-tail').replaceAll('[0,1079][720,1232]', '[0,1079][720,1231]');
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});

describe('bottom entry of the native merchant action strip', () => {
  const original = (): string => fixture('ranking/native-photo-module-empty-action-entry');
  it('accepts the actual empty action strip entering after the full quote', () => {
    expect(analyzeScreen(original(), 'spicy duck neck flushing').kind).toBe('results');
  });
  it.each([
    ['labeled strip', 'text=""', 'text="Unknown action"'],
    ['wrong class', 'class="android.widget.HorizontalScrollView"', 'class="android.widget.ScrollView"'],
    ['not scrollable', 'scrollable="true"', 'scrollable="false"'],
    ['not clickable', 'clickable="true"', 'clickable="false"'],
    ['missing scroll actions', 'actions="', 'actions="REMOVED_'],
    ['not at bottom', 'bounds="[0,1224][720,1232]"', 'bounds="[0,1224][720,1231]"'],
    ['overlap with quote', 'bounds="[0,1224][720,1232]"', 'bounds="[0,1190][720,1232]"'],
  ])('rejects %s', (_name, from, to) => {
    let source = original().replace(/<android\.widget\.HorizontalScrollView[^>]*bounds="\[0,1224\]\[720,1232\]"[^>]*>/u, tag => tag.replace(from, to));
    if (_name === 'missing scroll actions') source = source.replaceAll(',ACTION_SCROLL_RIGHT', '');
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'spicy duck neck flushing').kind).not.toBe('results');
  });
  it('rejects hidden extra actions or a mismatched empty inner group', () => {
    for (const source of [
      original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[0,1224\]\[720,1232\]"[^>]*>/u, tag => tag.replace('text=""', 'text="Directions"')),
      original().replace(/<android\.view\.ViewGroup[^>]*bounds="\[0,1224\]\[720,1232\]"[^>]*>/u, tag => tag.replace('bounds="[0,1224][720,1232]"', 'bounds="[1,1224][720,1232]"')),
    ]) expect(analyzeScreen(source, 'spicy duck neck flushing').kind).not.toBe('results');
  });
  it('does not borrow a later merchant to validate a photo-map tail separated by another module', () => {
    const tag = (cls: string, attrs: string, body = '') => `<node class="${cls}" package="com.google.android.apps.maps" enabled="true" bounds="[0,409][720,425]" ${attrs}>${body}</node>`;
    const image = tag('android.widget.ImageView', 'content-desc="Image result for hot pot near me posted by Another"');
    const module = tag('android.widget.FrameLayout', '', tag('android.widget.FrameLayout', '', tag('android.view.ViewGroup', '',
      tag('android.widget.HorizontalScrollView', 'scrollable="true"', tag('android.view.ViewGroup', '', tag('android.view.ViewGroup', '', image))))));
    const source = fixture('ranking/native-photo-module-control-tail').replace(/(<android\.widget\.FrameLayout[^>]*bounds="\[0,425\]\[720,1063\]"[^>]*>)/u, module + '$1');
    expect(inspectNativePhotoModuleTail(source, 'hot pot near me')).toBeNull();
  });
});

describe('bounded leading footer with a clipped empty native action row', () => {
  const original = (): string => fixture('ranking/native-photo-module-leading-row');
  it('accepts the actual 25px footer and its 1px empty native action row', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
  });
  it.each([
    ['oversized footer', '[0,274][720,299]', '[0,274][720,307]'],
    ['interior row', '[0,274][720,275]', '[0,275][720,276]'],
    ['row outside footer', '[0,274][720,275]', '[0,274][720,300]'],
    ['no backward proof', ',ACTION_SCROLL_BACKWARD', ''],
  ])('rejects the clipped action-row continuation with %s', (_name, from, to) => {
    expect(analyzeScreen(original().replaceAll(from, to), 'hot pot near me').kind).not.toBe('results');
  });
  it.each([
    ['text', 'text=""', 'text="Unproven action"'],
    ['no horizontal scroll action', ',ACTION_SCROLL_RIGHT', ''],
    ['not scrollable', 'scrollable="true"', 'scrollable="false"'],
  ])('rejects the clipped native row with %s', (_name, from, to) => {
    const source = original().replace(/<android\.widget\.HorizontalScrollView[^>]*bounds="\[0,274\]\[720,275\]"[^>]*>/u, tag => tag.replace(from, to));
    expect(source).not.toBe(original());
    expect(analyzeScreen(source, 'hot pot near me').kind).not.toBe('results');
  });
});


describe('Trial22 clipped native filters before the same merchant and photo module', () => {
  const original = (): string => fixture('ranking/trial22-clipped-filters-02');
  const change = (source: string, klass: string, bounds: string, edits: Record<string, string>): string => {
    const result = source.replace(new RegExp(`<${klass.replaceAll('.', '\\.')}[^>]*bounds="${bounds.replace(/[\[\]]/gu, '\\$&')}"[^>]*>`, 'u'), tag => {
      for (const [key, value] of Object.entries(edits)) tag = tag.replace(new RegExp(` ${key}="[^"]*"`, 'u'), ` ${key}="${value}"`);
      return tag;
    });
    expect(result).not.toBe(source); return result;
  };
  it.each([['01', false, 272], ['02', true, 274]] as const)('recognizes actual frame %s and preserves native backward state', (suffix, backward, top) => {
    const source = fixture(`ranking/trial22-clipped-filters-${suffix}`);
    expect(analyzeScreen(source, 'spicy duck neck flushing')).toMatchObject({ kind: 'results', queryVisible: true });
    expect(inspectNativeResultList(source, 'spicy duck neck flushing')).toMatchObject({ canScrollBackward: backward, canScrollForward: true, bounds: {left: 0, top, right: 720, bottom: 1232} });
  });
  it.each([
    ['wrong filter wrapper', 'android.widget.LinearLayout', '[0,274][720,289]', { class: 'android.widget.FrameLayout' }],
    ['foreign filter wrapper', 'android.widget.LinearLayout', '[0,274][720,289]', { package: 'com.example.other' }],
    ['filter not touching top', 'android.widget.LinearLayout', '[0,274][720,289]', { bounds: '[0,275][720,289]' }],
    ['wrong recycler role', 'android.support.v7.widget.RecyclerView', '[0,274][720,289]', { class: 'android.widget.HorizontalScrollView' }],
    ['wrong button child', 'android.widget.Button', '[112,274][329,289]', { class: 'android.widget.TextView' }],
    ['foreign button child', 'android.widget.Button', '[112,274][329,289]', { package: 'com.example.other' }],
    ['button bounds mismatch', 'android.widget.Button', '[112,274][329,289]', { bounds: '[113,274][329,289]' }],
    ['disabled button', 'android.widget.Button', '[112,274][329,289]', { enabled: 'false' }],
    ['unknown filter', 'android.widget.Button', '[544,274][720,289]', { 'content-desc': 'Unrecognized filter' }],
    ['foreign merchant', 'android.widget.FrameLayout', '[0,289][720,869]', { package: 'com.example.other' }],
  ] as const)('rejects %s', (_name, klass, bounds, edits) => {
    const source = change(original(), klass, bounds, edits);
    expect(analyzeScreen(source, 'spicy duck neck flushing').kind).not.toBe('results');
    expect(inspectNativeResultList(source, 'spicy duck neck flushing')).toBeNull();
  });
  it.each([
    ['extra filter-container child', 'android.widget.LinearLayout', '[0,274][720,289]'],
    ['extra label sibling', 'android.widget.FrameLayout', '[112,274][329,289]'],
    ['extra button descendant', 'android.widget.Button', '[112,274][329,289]'],
  ] as const)('rejects %s instead of borrowing known labels', (_name, klass, bounds) => {
    const source = original();
    const modified = source.replace(new RegExp(`(<${klass.replaceAll('.', '\\.')}[^>]*bounds="${bounds.replace(/[\[\]]/gu, '\\$&')}"[^>]*>)`, 'u'), '$1<node class="android.widget.TextView" package="com.google.android.apps.maps" enabled="true" text="Unexpected overlay" bounds="[112,274][329,289]"/>');
    expect(modified).not.toBe(source);
    expect(analyzeScreen(modified, 'spicy duck neck flushing').kind).not.toBe('results');
  });
  it('retains exact query, module identity, merchant actions and native scroll proof', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).not.toBe('results');
    for (const source of [original().replaceAll('Image result for spicy duck neck flushing posted by', 'Image result for another query posted by'), original().replaceAll('content-desc="Directions"', 'content-desc="Not Directions"'), original().replaceAll(',ACTION_SCROLL_TO_POSITION', ''), original().replaceAll(',ACTION_SCROLL_FORWARD', '')]) {
      expect(analyzeScreen(source, 'spicy duck neck flushing').kind).not.toBe('results');
    }
  });
});


describe('Trial23 iconless top-clipped photo map control', () => {
  const original = (): string => fixture('ranking/trial23-iconless-photo-map-tail');
  const control = /<android\.view\.ViewGroup[^>]*bounds="\[40,274\]\[680,284\]"[^>]*\/>/u;
  it('recognizes the actual closed tail after its icon has left the viewport', () => {
    expect(analyzeScreen(original(), 'hot pot near me').kind).toBe('results');
    expect(inspectNativePhotoModuleTail(original(), 'hot pot near me')).toEqual({left:0,top:274,right:720,bottom:324});
    expect(inspectNativeResultList(original(), 'hot pot near me')?.canScrollBackward).toBe(true);
  });
  it.each([
    ['not top clipped', 'bounds="[40,274][680,284]"', 'bounds="[40,275][680,285]"'],
    ['wrong label', 'content-desc="View photo map"', 'content-desc="View map"'],
    ['not clickable', 'clickable="true"', 'clickable="false"'],
    ['no click action', ',ACTION_CLICK', ''],
    ['disabled control', 'enabled="true"', 'enabled="false"'],
    ['foreign control', 'package="com.google.android.apps.maps"', 'package="com.example.foreign"'],
    ['wrong control role', 'class="android.view.ViewGroup"', 'class="android.widget.Button"'],
  ])('rejects an iconless control with %s', (_name, from, to) => {
    const source = original().replace(control, tag => tag.replace(from,to));
    expect(source).not.toBe(original());
    expect(inspectNativePhotoModuleTail(source,'hot pot near me')).toBeNull();
    // A different label may remain an ordinary list fragment under the existing
    // generic layout branch, but cannot receive this photo-module identity proof.
    if (_name !== 'wrong label') expect(analyzeScreen(source,'hot pot near me').kind).not.toBe('results');
  });
  it('rejects arbitrary descendants and additional native siblings', () => {
    const source=original();
    for (const modified of [source.replace(control,tag => tag.replace('/>','><node package="com.google.android.apps.maps" class="android.widget.TextView" enabled="true" text="Unproven" bounds="[40,274][680,284]"/></android.view.ViewGroup>')), source.replace(control,tag => tag+'<node package="com.google.android.apps.maps" class="android.view.View" enabled="true" bounds="[40,284][680,294]"/>')]) {
      expect(modified).not.toBe(source);
      expect(inspectNativePhotoModuleTail(modified,'hot pot near me')).toBeNull();
    }
  });
  it('retains exact query, backward action and immediately adjacent proven merchant gates', () => {
    expect(inspectNativePhotoModuleTail(original(),'another query')).toBeNull();
    for (const source of [original().replaceAll(',ACTION_SCROLL_BACKWARD',''),original().replaceAll('content-desc="Directions"','content-desc="Unknown action"').replaceAll('content-desc="Reserve"','content-desc="Unknown action"').replaceAll('content-desc="Order"','content-desc="Unknown action"')]) {
      expect(inspectNativePhotoModuleTail(source,'hot pot near me')).toBeNull();
    }
  });
});
