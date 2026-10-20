import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ScreenAnalysis, ScreenKind, UiNode } from './contracts.js';

const MAPS_PACKAGE = 'com.google.android.apps.maps';
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 10_000;
const MAX_DEPTH = 128;
type XmlEntry = Record<string, unknown>;
interface EvidenceNode extends UiNode { enabled: boolean; scrollable: boolean; heading: boolean; hint: string; showingHint: boolean; actions: string[] | null; parent: EvidenceNode | null; foreignDescendant: boolean }

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function validXmlCodePoint(value: number): boolean {
  return value === 9 || value === 10 || value === 13 ||
    (value >= 0x20 && value <= 0xd7ff) || (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff);
}

function validateXml(xml: string): void {
  if (!xml.trim() || Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new Error('Native UI XML is empty or exceeds the size limit');
  }
  // Never allow DTDs, entity declarations, or custom entity expansion. Standard
  // XML escapes are needed to preserve ordinary business names such as A & B.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || /<!\[CDATA\[/i.test(xml)) {
    throw new Error('Native UI XML declarations and CDATA are not supported');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-fA-F]{1,6});)/u.test(xml)) {
    throw new Error('Native UI XML contains an invalid or unsupported entity');
  }
  for (const match of xml.matchAll(/&#(x[\da-fA-F]+|\d+);/gu)) {
    const raw = match[1]!;
    const codePoint = raw.startsWith('x') ? Number.parseInt(raw.slice(1), 16) : Number(raw);
    if (!validXmlCodePoint(codePoint)) throw new Error('Native UI XML contains an invalid character reference');
  }
  for (const char of xml) {
    if (!validXmlCodePoint(char.codePointAt(0)!)) throw new Error('Native UI XML contains an invalid character');
  }
  if (/=\s*(?:"[^"]*<|'[^']*<)/u.test(xml)) throw new Error('Native UI XML contains unescaped markup in an attribute');
  if (XMLValidator.validate(xml) !== true) throw new Error('Malformed native UI XML');
}

function parseBounds(value: string): UiNode['bounds'] {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value);
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number) as [number, number, number, number];
  if (![left, top, right, bottom].every(Number.isSafeInteger) || right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function parseEvidence(xml: string): EvidenceNode[] {
  validateXml(xml);
  const parser = new XMLParser({
    preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '',
    parseAttributeValue: false, parseTagValue: false, trimValues: false,
    processEntities: true, htmlEntities: true, ignoreDeclaration: true, ignorePiTags: true,
    maxNestedTags: MAX_DEPTH,
  });
  const document: XmlEntry[] = parser.parse(xml);
  if (!Array.isArray(document) || document.length !== 1 || !Array.isArray(document[0]?.hierarchy)) {
    throw new Error('Native UI XML must have one hierarchy root');
  }
  const nodes: EvidenceNode[] = [];
  let count = 0;
  const visit = (entries: XmlEntry[], depth: number, parentPackage: string, parentVisible: boolean, parentEnabled: boolean, parent: EvidenceNode | null): void => {
    if (depth > MAX_DEPTH) throw new Error('Native UI XML exceeds the nesting limit');
    for (const entry of entries) {
      const keys = Object.keys(entry).filter((key) => key !== ':@');
      if (keys.length !== 1) throw new Error('Invalid native UI XML node');
      const tag = keys[0]!;
      if (tag === '#text' && typeof entry[tag] === 'string' && !(entry[tag] as string).trim()) continue;
      if (tag !== 'node' && !/^(?:android|androidx|com)\.[\w.$]+$/.test(tag)) {
        throw new Error('Unsupported element in native UI XML');
      }
      if (++count > MAX_NODES) throw new Error('Native UI XML exceeds the node limit');
      const attributes = (entry[':@'] ?? {}) as Record<string, string>;
      const attr = (name: string): string => typeof attributes[name] === 'string' ? attributes[name] : '';
      const visible = parentVisible && !['false', '0'].includes(attr('displayed').toLowerCase()) &&
        !['false', '0'].includes(attr('visible-to-user').toLowerCase());
      const enabled = parentEnabled && !['false', '0'].includes(attr('enabled').toLowerCase());
      const packageName = attr('package') || parentPackage;
      let current = parent;
      if (visible) {
        current = {
          text: attr('text'), description: attr('content-desc'), resourceId: attr('resource-id'),
          className: attr('class') || (tag === 'node' ? '' : tag), packageName,
          clickable: attr('clickable') === 'true', bounds: parseBounds(attr('bounds')),
          enabled, scrollable: attr('scrollable') === 'true', heading: attr('heading') === 'true',
          hint: attr('hint'), showingHint: attr('showing-hint') === 'true',
          actions: attr('actions').trim() ? attr('actions').split(',').map(action => action.trim()) : null, parent, foreignDescendant: false,
        };
        // Preserve closure evidence even when callers later select Maps-owned
        // nodes. A filtered foreign subtree must not become an empty known shape.
        if (packageName !== MAPS_PACKAGE) {
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent) ancestor.foreignDescendant = true;
        }
        nodes.push(current);
      }
      if (!Array.isArray(entry[tag])) throw new Error('Invalid native UI XML children');
      visit(entry[tag] as XmlEntry[], depth + 1, packageName, visible, enabled, current);
    }
  };
  visit(document[0]!.hierarchy as XmlEntry[], 1, '', true, true, null);
  return nodes;
}

/** Visible native nodes in source order. No listing identity or rank is inferred. */
export function parseUiNodes(xml: string): UiNode[] {
  return parseEvidence(xml).map(({ enabled: _enabled, scrollable: _scrollable, heading: _heading, hint: _hint, showingHint: _showingHint, actions: _actions, parent: _parent, foreignDescendant: _foreignDescendant, ...node }) => node);
}

/** A display wrapper can advertise a rotating suggestion without containing a query. */
export function hasBlankNativeSearchWrapper(xml: string): boolean {
  const nodes = parseEvidence(xml);
  const fields = nodes.filter(node => node.packageName === MAPS_PACKAGE &&
    /^com\.google\.android\.apps\.maps:id\/search_omnibox_text_box(?:_search)?$/.test(node.resourceId));
  if (fields.length !== 1) return false;
  const wrapper = fields[0]!;
  if (!wrapper.enabled || wrapper.className !== 'android.widget.EditText' || wrapper.text !== '') return false;
  const descendants = nodes.filter(node => {
    for (let parent = node.parent; parent; parent = parent.parent) if (parent === wrapper) return true;
    return false;
  });
  // Preserve the previously verified simple layout only when no descendant can
  // hide an entered query. New suggestion wording must prove native hint state.
  if (descendants.length === 0) return ['Search here', 'Search Google Maps'].includes(wrapper.description);
  if (!wrapper.clickable || !wrapper.bounds || !wrapper.description.trim()) return false;
  const hintNodes = descendants.filter(node => node.parent === wrapper && node.packageName === MAPS_PACKAGE && node.enabled &&
    node.className === 'android.widget.TextView' && !node.resourceId && !node.clickable && node.showingHint &&
    node.hint === wrapper.description && node.text === node.hint && node.description === '' && node.bounds !== null && insideBounds(node.bounds, wrapper.bounds!));
  if (hintNodes.length !== 1) return false;
  // The observed home wrapper contains only its direct native hint and blank
  // image control. A nested input, other text, or foreign-package child is not blank.
  return descendants.every(node => node === hintNodes[0] || (node.parent === wrapper && node.packageName === MAPS_PACKAGE && node.enabled &&
    node.className === 'android.widget.ImageView' && !node.resourceId && !node.clickable && node.text === '' && node.description === '' &&
    node.bounds !== null && insideBounds(node.bounds, wrapper.bounds!)));
}

function labels(node: UiNode): string[] {
  return [node.text, node.description].filter((value) => value.trim());
}

function hasLabel(node: UiNode, values: string[]): boolean {
  return labels(node).some((label) => values.includes(normalized(label)));
}

function queryMatches(node: EvidenceNode, query: string): boolean {
  if (!query || !node.enabled) return false;
  const id = node.resourceId.split('/').at(-1) ?? '';
  const editText = /(?:^|\.)EditText$/.test(node.className);
  const searchId = /^(?:search_omnibox_(?:text_box(?:_search)?|edit_text)|search_(?:box|query|input|field|edit_text)|query_(?:text|input|field))$/.test(id);
  const searchDescription = /^(?:search here|search google maps|search maps|search|search query|search for)(?::|\s|$)/.test(normalized(node.description));
  if (!searchId && !(editText && searchDescription)) return false;
  return labels(node).some((value) => {
    const label = normalized(value);
    return label === query || label.replace(/^(?:search query|search google maps|search maps|search for|search)\s*:\s*/, '') === query;
  });
}

function withinMaps(node: EvidenceNode, container: EvidenceNode): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.packageName !== MAPS_PACKAGE) return false;
    if (parent === container) return true;
  }
  return false;
}

function insideBounds(inner: NonNullable<UiNode['bounds']>, outer: NonNullable<UiNode['bounds']>): boolean {
  return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

/** The reader uses the same native image-grid predicate; a module is never a merchant. */
function nativePhotoModule(nodes: EvidenceNode[], card: EvidenceNode, exactKeyword: string): boolean {
  if (!card.bounds) return false;
  const exact = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const prefix = `Image result for ${exact(exactKeyword)} posted by `;
  const scope = nodes.filter(node => node.enabled && withinMaps(node, card));
  const labeled = scope.filter(node => labels(node).length > 0);
  const images = labeled.filter(node => {
    const tile = node.parent, grid = tile?.parent, row = grid?.parent;
    return node.className === 'android.widget.ImageView' && node.bounds !== null && insideBounds(node.bounds, card.bounds!) &&
      exact(node.description).startsWith(prefix) && exact(node.description).length > prefix.length &&
      labels(node).every(label => exact(label).startsWith(prefix) && exact(label).length > prefix.length) &&
      tile?.enabled === true && tile.className === 'android.view.ViewGroup' &&
      grid?.enabled === true && grid.className === 'android.view.ViewGroup' &&
      row?.enabled === true && row.className === 'android.widget.HorizontalScrollView' && row.scrollable &&
      row.bounds !== null && insideBounds(row.bounds, card.bounds!) && withinMaps(row, card);
  });
  if (!images.length) return false;
  const extra = labeled.filter(node => !images.includes(node));
  if (!extra.length) return true;
  if (extra.length !== 1) return false;
  const control = extra[0]!, body = control.parent, frame = body?.parent;
  const rows = [...new Set(images.map(node => node.parent!.parent!.parent!))];
  return control.className === 'android.view.ViewGroup' && control.clickable && !control.scrollable &&
    control.actions?.includes('ACTION_CLICK') === true && exact(control.description) === 'View photo map' &&
    labels(control).every(label => exact(label) === 'View photo map') && !control.resourceId && control.bounds !== null &&
    insideBounds(control.bounds, card.bounds!) && rows.every(row => row.parent === body && control.bounds!.top >= row.bounds!.bottom) &&
    body?.enabled === true && body.className === 'android.view.ViewGroup' && !body.clickable && body.bounds !== null &&
    insideBounds(body.bounds, card.bounds!) && insideBounds(card.bounds!, body.bounds) &&
    frame?.enabled === true && frame.className === 'android.widget.FrameLayout' && frame.parent === card;

}

/** Observed bottom-clipped card: anonymous header metadata above a clipped photo strip.
 * This permits evidence capture only. OCR and cross-frame reconciliation still decide
 * whether the header, merchant identity, ad classification and sequence are proven.
 */
function populatedClippedNativeHeader(nodes: EvidenceNode[], card: EvidenceNode): boolean {
  if (!card.bounds || card.clickable || card.scrollable) return false;
  const scope = nodes.filter(node => withinMaps(node, card));
  const children = (parent: EvidenceNode): EvidenceNode[] => scope.filter(node => node.parent === parent);
  const same = (left: EvidenceNode, right: EvidenceNode): boolean => !!left.bounds && !!right.bounds &&
    insideBounds(left.bounds, right.bounds) && insideBounds(right.bounds, left.bounds);
  if (scope.some(node => !node.enabled || node.packageName !== MAPS_PACKAGE || node.resourceId || !node.bounds ||
    !insideBounds(node.bounds, card.bounds!) || !node.parent?.bounds || !insideBounds(node.bounds, node.parent.bounds))) return false;
  const [frame] = children(card), body = frame && children(frame)[0];
  if (!frame || !body || children(card).length !== 1 || children(frame).length !== 1 ||
    frame.className !== 'android.widget.FrameLayout' || frame.clickable || frame.scrollable || labels(frame).length || !same(frame, card) ||
    body.className !== 'android.view.ViewGroup' || !body.clickable || body.scrollable || labels(body).length ||
    !body.actions?.includes('ACTION_CLICK') || !same(body, card)) return false;
  const direct = children(body);
  const rowIndex = direct.findIndex(node => node.className === 'android.widget.HorizontalScrollView');
  const row = rowIndex >= 0 ? direct[rowIndex] : undefined;
  const metadata = row ? direct.slice(0, rowIndex) : direct;
  const suffix = row ? direct.slice(rowIndex + 1) : [];
  if (metadata.length < 2 || metadata.some(group => group.className !== 'android.view.ViewGroup' || group.clickable || group.scrollable || labels(group).length ||
    group.bounds!.top <= card.bounds!.top || group.bounds!.bottom > (row?.bounds?.top ?? card.bounds!.bottom) || children(group).length > 1 ||
    children(group).some(icon => icon.className !== 'android.widget.ImageView' || icon.clickable || icon.scrollable || children(icon).length > 0 ||
      labels(icon).some(label => normalized(label) !== 'wheelchair accessible')))) return false;
  // At the bottom edge only the drawn header metadata may have entered the
  // viewport. It remains incomplete to the OCR reader until its photo row appears.
  if (!row) return card.bounds.bottom - card.bounds.top <= 260;
  const maxGap = Math.min(16, Math.floor((card.bounds.right - card.bounds.left) * 16 / 720));
  if (!row.bounds || !row.clickable || !row.scrollable || labels(row).length ||
    !row.actions?.includes('ACTION_SCROLL_RIGHT') || !row.actions.includes('ACTION_SCROLL_FORWARD') ||
    row.bounds.left !== card.bounds.left || row.bounds.right !== card.bounds.right ||
    row.bounds.top <= card.bounds.top || row.bounds.top > card.bounds.top + 260 || suffix.length > 2) return false;
  const actionEntry = suffix.at(-1)?.className === 'android.widget.HorizontalScrollView' ? suffix.at(-1) : undefined;
  const afterPhotos = actionEntry ? suffix.slice(0, -1) : suffix;
  if (afterPhotos.length > 1) return false;
  const quote = afterPhotos[0];
  if (quote) {
    // A drawn review quote can be partially or fully visible, with an optional
    // anonymous avatar. Its closed native subtree, order and bounds prove shape;
    // text length or the amount left below it is not a semantic layout signal.
    const icons = children(quote);
    if (quote.className !== 'android.view.ViewGroup' || quote.clickable || quote.scrollable || labels(quote).length ||
      quote.bounds!.top < row.bounds.bottom || quote.bounds!.top - row.bounds.bottom > maxGap || icons.length > 1 ||
      icons.some(icon => icon.className !== 'android.widget.ImageView' || icon.clickable || icon.scrollable || labels(icon).length || children(icon).length)) return false;
  } else if (!actionEntry && card.bounds.bottom - row.bounds.bottom > maxGap) return false;
  if (actionEntry) {
    const [emptyGrid] = children(actionEntry);
    // The merchant action strip can enter before any buttons are visible. Its
    // closed native empty-scroller subtree is evidence geometry, not an action
    // label or a merchant identity. No visible-height threshold is needed.
    if (!actionEntry.bounds || !actionEntry.clickable || !actionEntry.scrollable || labels(actionEntry).length ||
      !actionEntry.actions?.includes('ACTION_SCROLL_RIGHT') || !actionEntry.actions.includes('ACTION_SCROLL_FORWARD') ||
      actionEntry.bounds.left !== card.bounds.left || actionEntry.bounds.right !== card.bounds.right ||
      actionEntry.bounds.bottom !== card.bounds.bottom || actionEntry.bounds.top < (quote?.bounds?.bottom ?? row.bounds.bottom) ||
      children(actionEntry).length !== 1 || !emptyGrid || emptyGrid.className !== 'android.view.ViewGroup' ||
      emptyGrid.clickable || emptyGrid.scrollable || labels(emptyGrid).length || children(emptyGrid).length || !same(emptyGrid, actionEntry)) return false;
  }
  const [grid] = children(row);
  if (!grid || children(row).length !== 1 || grid.className !== 'android.view.ViewGroup' || grid.clickable || grid.scrollable || labels(grid).length || !same(grid, row)) return false;
  const tiles = children(grid);
  if (tiles.length < 2 || tiles.some((tile, index) => tile.className !== 'android.view.ViewGroup' || !tile.clickable || tile.scrollable ||
    labels(tile).length || !tile.actions?.includes('ACTION_CLICK') || tile.bounds!.top !== row.bounds!.top || tile.bounds!.bottom !== row.bounds!.bottom ||
    (index > 0 && tile.bounds!.left < tiles[index - 1]!.bounds!.right))) return false;
  return tiles.every(tile => {
    const contents = scope.filter(node => withinMaps(node, tile));
    // Actual Maps photo tiles are either one ImageView or the observed native
    // video thumbnail wrapper. Neither contains merchant names or action labels.
    if (contents.some(node => labels(node).length || node.scrollable || !same(node, tile))) return false;
    const [image] = children(tile);
    if (contents.length === 1) return image?.className === 'android.widget.ImageView';
    const outer = image, inner = outer && children(outer)[0];
    const leaves = inner ? children(inner) : [];
    return contents.length === 4 && children(tile).length === 1 && outer?.className === 'android.widget.FrameLayout' && !outer.clickable &&
      children(outer).length === 1 && inner?.className === 'android.widget.FrameLayout' && !inner.clickable && leaves.length === 2 &&
      leaves[0]?.className === 'android.view.View' && !leaves[0].clickable &&
      leaves[1]?.className === 'android.widget.ImageView' && !leaves[1].clickable;
  });
}

/** The top-clipped tail of an observed photo module, never a merchant card. */
function nativePhotoMapTail(nodes: EvidenceNode[], card: EvidenceNode): boolean {
  if (!card.bounds || card.clickable || card.scrollable || card.foreignDescendant) return false;
  const scope = nodes.filter(node => withinMaps(node, card));
  const children = (parent: EvidenceNode): EvidenceNode[] => scope.filter(node => node.parent === parent);
  const [frame] = children(card), body = frame && children(frame)[0];
  if (!frame || !body || children(card).length !== 1 || children(frame).length !== 1 ||
    scope.some(node => !node.enabled || node.packageName !== MAPS_PACKAGE || node.resourceId || !node.bounds ||
      !insideBounds(node.bounds, card.bounds!) || !node.parent?.bounds || !insideBounds(node.bounds, node.parent.bounds))) return false;
  const same = (node: EvidenceNode): boolean => insideBounds(card.bounds!, node.bounds!) && insideBounds(node.bounds!, card.bounds!);
  if (!(frame.className === 'android.widget.FrameLayout' && !frame.clickable && !frame.scrollable && !labels(frame).length && same(frame) &&
    body.className === 'android.view.ViewGroup' && !body.clickable && !body.scrollable && !labels(body).length && same(body))) return false;
  const direct = children(body), control = direct.at(-1), icon = control && children(control)[0];
  if (!control || ![1, 2].includes(direct.length) || control.className !== 'android.view.ViewGroup' || !control.clickable || control.scrollable ||
    !control.actions?.includes('ACTION_CLICK') || control.description !== 'View photo map' || !labels(control).every(label => label === 'View photo map')) return false;
  // The icon can leave the viewport before the labeled control's bottom edge.
  // Only the closed, sole control touching the clipped card top qualifies;
  // an interior iconless button or an extra descendant remains unsupported.
  if (!icon) return direct.length === 1 && scope.length === 3 && control.bounds!.top === card.bounds.top;
  if (children(control).length !== 1 || icon.className !== 'android.widget.ImageView' || icon.clickable || icon.scrollable || labels(icon).length || children(icon).length) return false;
  if (direct.length === 1) return scope.length === 4;
  // A photo module may retain the clipped category/distance carousel after its
  // images leave the viewport. Its anonymous tiles are never merchant fields.
  const row = direct[0]!, grid = children(row)[0];
  if (row.className !== 'android.widget.HorizontalScrollView' || !row.clickable || !row.scrollable || labels(row).length ||
    !['ACTION_CLICK', 'ACTION_SCROLL_FORWARD', 'ACTION_SCROLL_RIGHT'].every(action => row.actions?.includes(action)) ||
    row.bounds!.top !== card.bounds.top || row.bounds!.left !== card.bounds.left || row.bounds!.right !== card.bounds.right ||
    row.bounds!.bottom > control.bounds!.top || children(row).length !== 1 || !grid || grid.className !== 'android.view.ViewGroup' ||
    grid.clickable || grid.scrollable || labels(grid).length || !insideBounds(row.bounds!, grid.bounds!) || !insideBounds(grid.bounds!, row.bounds!)) return false;
  const tiles = children(grid);
  if (tiles.length < 2 || scope.length !== 6 + tiles.length) return false;
  let previousRight = row.bounds!.left;
  return tiles.every(tile => {
    if (tile.className !== 'android.view.ViewGroup' || !tile.clickable || tile.scrollable || !tile.actions?.includes('ACTION_CLICK') ||
      labels(tile).length || children(tile).length || tile.bounds!.top !== row.bounds!.top || tile.bounds!.bottom !== row.bounds!.bottom ||
      tile.bounds!.left < previousRight) return false;
    previousRight = tile.bounds!.right;
    return true;
  });
}

/** A query-specific photo module may be traversed only after native backward-scroll proof. */
function scrolledPhotoModuleContinuation(nodes: EvidenceNode[], list: EvidenceNode, exactKeyword: string): boolean {
  if (!list.bounds || !list.actions?.includes('ACTION_SCROLL_TO_POSITION') || !list.actions.includes('ACTION_SCROLL_BACKWARD')) return false;
  const cards = nodes.filter(node => node.parent === list);
  if (!cards.length || cards.some(card => !card.enabled || card.className !== 'android.widget.FrameLayout' ||
    card.resourceId || labels(card).length || !card.bounds || card.bounds.left !== list.bounds!.left ||
    card.bounds.right !== list.bounds!.right || !insideBounds(card.bounds, list.bounds!))) return false;
  if (cards.some((card, index) => index > 0 && card.bounds!.top < cards[index - 1]!.bounds!.bottom)) return false;
  const modules = new Set(cards.filter(card => nativePhotoModule(nodes, card, exactKeyword)));
  const merchants = new Set(cards.filter(card => {
    if (modules.has(card)) return false;
    const scope = nodes.filter(node => node.enabled && withinMaps(node, card));
    // A wrong-query image or mixed module must not be relabeled as a merchant.
    if (scope.some(node => labels(node).some(label => (normalized(label).startsWith('image result for ') || normalized(label) === 'view photo map')))) return false;
    return scope.some(row => row.className === 'android.widget.HorizontalScrollView' && row.scrollable && row.bounds !== null &&
      insideBounds(row.bounds, card.bounds!) && new Set(scope.filter(node => node.clickable && node.bounds !== null && withinMaps(node, row))
        .flatMap(node => {
          const matches = [...new Set(labels(node).map(normalized).filter(label => ['directions', 'call', 'website', 'menu', 'share', 'save', 'reserve', 'order'].includes(label)))];
          return matches.length === 1 ? matches : [];
        })).size >= 2);
  }));
  const moduleTail = cards[0];
  if (moduleTail?.bounds?.top === list.bounds.top && cards[1] && merchants.has(cards[1]) && nativePhotoMapTail(nodes, moduleTail)) modules.add(moduleTail);
  if (!modules.size) return false;
  // A trailing card can enter by any clipped height. Its exact empty native
  // wrapper permits capture, never identity: the reader keeps it incomplete and
  // the reconciler requires later header evidence before assigning a position.
  // Leading footers remain bounded at 32px (scaled down on narrower screens).
  const maxFragmentHeight = Math.min(32, Math.floor((list.bounds.right - list.bounds.left) * 32 / 720));
  const emptyNativeCard = (card: EvidenceNode, allowClippedRow = false): boolean => {
    const fragmentNodes = nodes.filter(node => withinMaps(node, card));
    const [frame, body, row, grid] = fragmentNodes;
    if (card.clickable || card.scrollable || !frame || !body ||
      fragmentNodes.some(node => !node.enabled || node.resourceId || labels(node).length || !node.bounds || !insideBounds(node.bounds, card.bounds!)) ||
      frame.parent !== card || frame.className !== 'android.widget.FrameLayout' || frame.clickable || frame.scrollable ||
      body.parent !== frame || body.className !== 'android.view.ViewGroup' || !body.clickable || body.scrollable || !body.actions?.includes('ACTION_CLICK') ||
      !insideBounds(card.bounds!, frame.bounds!) || !insideBounds(card.bounds!, body.bounds!)) return false;
    if (fragmentNodes.length === 2) return true;
    // At the top edge a cropped action row can remain as an empty horizontal
    // scroller and its sole empty group. No labels or extra descendants qualify.
    return allowClippedRow && fragmentNodes.length === 4 && !!row && !!grid &&
      row.parent === body && row.className === 'android.widget.HorizontalScrollView' && row.clickable && row.scrollable &&
      row.actions?.includes('ACTION_SCROLL_RIGHT') === true && row.actions.includes('ACTION_SCROLL_FORWARD') &&
      row.bounds!.top === list.bounds!.top && row.bounds!.left === card.bounds!.left && row.bounds!.right === card.bounds!.right &&
      grid.parent === row && grid.className === 'android.view.ViewGroup' && !grid.clickable && !grid.scrollable &&
      insideBounds(row.bounds!, grid.bounds!) && insideBounds(grid.bounds!, row.bounds!);
  };
  const first = cards[0]!, last = cards.at(-1)!;
  // A further observed scroll leaves only the prior merchant's 7px footer and
  // the validated photo module. Keep that footer as unknown overlap geometry.
  const soleModuleAfterFooter = cards.length === 2 && modules.has(last);
  const leadingFragment = (merchants.size > 0 || soleModuleAfterFooter) && first.bounds!.top === list.bounds.top &&
    first.bounds!.bottom - first.bounds!.top <= maxFragmentHeight && emptyNativeCard(first, true);
  const trailingFragment = cards.length > 1 && (modules.has(cards.at(-2)!) || merchants.has(cards.at(-2)!)) && list.actions.includes('ACTION_SCROLL_FORWARD') &&
    last.bounds!.bottom === list.bounds.bottom && (emptyNativeCard(last) || populatedClippedNativeHeader(nodes, last));
  return cards.every(card => modules.has(card) || merchants.has(card) ||
    (card === first && leadingFragment) || (card === last && trailingFragment));


}

function labelIdentity(node: EvidenceNode, names: string[]): string | null {
  const matches = [...new Set(labels(node).map(normalized).filter((label) => names.includes(label)))];
  return matches.length === 1 ? matches[0]! : null;
}
function controlLabel(node: EvidenceNode, names: string[]): string | null {
  if (!node.enabled || !node.clickable || node.bounds === null) return null;
  return labelIdentity(node, names);
}
function controls(scope: EvidenceNode[], names: string[]): boolean {
  const found = new Set(scope.map((node) => {
    const direct = controlLabel(node, names);
    if (direct !== null) return direct;
    // Observed Koreatown filters expose clickability on an unlabeled parent and
    // the label on its sole, same-bounds Button child. Do not borrow other text.
    if (!node.enabled || !node.clickable || node.bounds === null || labels(node).length ||
        node.className !== 'android.widget.FrameLayout') return null;
    const children = scope.filter((child) => child.parent === node);
    if (children.length !== 1) return null;
    const child = children[0]!;
    if (!child.enabled || child.clickable || child.packageName !== MAPS_PACKAGE ||
        child.className !== 'android.widget.Button' || child.bounds === null ||
        child.bounds.left !== node.bounds.left || child.bounds.top !== node.bounds.top ||
        child.bounds.right !== node.bounds.right || child.bounds.bottom !== node.bounds.bottom) return null;
    return labelIdentity(child, names);
  }));
  return names.every((name) => found.has(name));
}

/** The same native filters remain as a clipped strip during the first scroll. */
function closedScrolledFilters(nodes: EvidenceNode[], container: EvidenceNode, row: EvidenceNode): boolean {
  if (container.foreignDescendant || !row.bounds || nodes.filter(node => node.parent === container).length !== 1) return false;
  const allowed = ['more filters', 'relevance', 'open now', 'find a table'];
  const children = nodes.filter(node => node.parent === row);
  const seen = new Set<string>();
  let lastRight = row.bounds.left;
  for (const child of children) {
    if (!child.enabled || !child.clickable || child.scrollable || !child.bounds || child.resourceId ||
      child.bounds.top !== row.bounds.top || child.bounds.bottom !== row.bounds.bottom ||
      child.bounds.left < lastRight || !insideBounds(child.bounds, row.bounds)) return false;
    const descendants = nodes.filter(node => withinMaps(node, child) && node !== child);
    if (descendants.length !== 1) return false;
    const label = descendants[0]!;
    if (label.parent !== child || !label.enabled || label.clickable || label.scrollable || label.resourceId || !label.bounds ||
      !insideBounds(label.bounds, child.bounds) || !insideBounds(child.bounds, label.bounds)) return false;
    const identity = labelIdentity(label, allowed);
    if (!identity || labels(label).some(value => normalized(value) !== identity) || seen.has(identity)) return false;
    if (child.className === 'android.widget.FrameLayout') {
      if (labels(child).length || label.className !== 'android.widget.Button') return false;
    } else if (child.className === 'android.widget.Button') {
      if (label.className !== 'android.view.View' || labelIdentity(child, allowed) !== identity ||
        labels(child).some(value => normalized(value) !== identity)) return false;
    } else return false;
    seen.add(identity);
    lastRight = child.bounds.right;
  }
  return ['more filters', 'relevance', 'open now'].every(name => seen.has(name));
}

/** Observed ordered native filters, one merchant card, then an embedded photo module. */
function filteredPhotoModuleList(nodes: EvidenceNode[], list: EvidenceNode, exactKeyword: string): boolean {
  if (!list.bounds || list.foreignDescendant || !list.actions?.includes('ACTION_SCROLL_TO_POSITION') || !list.actions.includes('ACTION_SCROLL_FORWARD')) return false;
  const direct = nodes.filter(node => node.parent === list);
  if (direct.length !== 3) return false;
  const [filterContainer, merchant, module] = direct as [EvidenceNode, EvidenceNode, EvidenceNode];
  if (!filterContainer.enabled || filterContainer.className !== 'android.widget.LinearLayout' || !filterContainer.bounds ||
    filterContainer.bounds.top !== list.bounds.top || filterContainer.bounds.left !== list.bounds.left || filterContainer.bounds.right !== list.bounds.right ||
    !insideBounds(filterContainer.bounds, list.bounds) || labels(filterContainer).length) return false;
  const filters = nodes.filter(node => node.parent === filterContainer && node.enabled && node.scrollable && node.bounds !== null &&
    node.className === 'android.support.v7.widget.RecyclerView' && node.resourceId === `${MAPS_PACKAGE}:id/recycler_view` &&
    insideBounds(node.bounds, filterContainer.bounds!) && insideBounds(filterContainer.bounds!, node.bounds));
  if (filters.length !== 1 || (list.actions.includes('ACTION_SCROLL_BACKWARD') && !closedScrolledFilters(nodes, filterContainer, filters[0]!))) return false;
  const filterScope = nodes.filter(node => node.enabled && node.bounds !== null && withinMaps(node, filters[0]!) &&
    insideBounds(node.bounds, filters[0]!.bounds!));
  if (!controls(filterScope, ['more filters', 'relevance', 'open now'])) return false;
  if ([merchant, module].some(card => !card.enabled || card.className !== 'android.widget.FrameLayout' || card.resourceId || labels(card).length ||
    !card.bounds || card.bounds.left !== list.bounds!.left || card.bounds.right !== list.bounds!.right || !insideBounds(card.bounds, list.bounds!)) ||
    merchant.bounds!.top !== filterContainer.bounds.bottom || module.bounds!.top < merchant.bounds!.bottom || module.bounds!.bottom !== list.bounds.bottom ||
    !nativePhotoModule(nodes, module, exactKeyword)) return false;
  const scope = nodes.filter(node => node.enabled && withinMaps(node, merchant));
  if (scope.some(node => labels(node).some(label => normalized(label).startsWith('image result for ') || normalized(label) === 'view photo map'))) return false;
  const frame = scope.find(node => node.parent === merchant && node.className === 'android.widget.FrameLayout');
  const body = scope.find(node => node.parent === frame && node.className === 'android.view.ViewGroup' && node.clickable && !node.scrollable);
  if (!frame?.bounds || !body?.bounds || !insideBounds(merchant.bounds!, frame.bounds) || !insideBounds(frame.bounds, merchant.bounds!) ||
    !insideBounds(merchant.bounds!, body.bounds) || !insideBounds(body.bounds, merchant.bounds!)) return false;
  return scope.some(row => row.parent === body && row.className === 'android.widget.HorizontalScrollView' && row.scrollable && row.bounds !== null &&
    insideBounds(row.bounds, merchant.bounds!) && (() => {
      const names = new Set(scope.filter(node => node.clickable && node.bounds !== null && withinMaps(node, row) && insideBounds(node.bounds, row.bounds!))
        .flatMap(node => {
          const matches = [...new Set(labels(node).map(normalized).filter(label => ['directions', 'call', 'website', 'menu', 'share', 'save', 'reserve', 'order'].includes(label)))];
          return matches.length === 1 ? matches : [];
        }));
      return names.has('directions') && names.size >= 2;
    })());
}

/** Specific search-panel structures observed in the supplied Maps 26.41 captures. */
function liveSearchLists(nodes: EvidenceNode[], query: string, exactKeyword = query): EvidenceNode[] {
  const id = (name: string): string => `${MAPS_PACKAGE}:id/${name}`;
  const recycler = (node: EvidenceNode): boolean => node.enabled && node.scrollable && node.bounds !== null &&
    node.className === 'android.support.v7.widget.RecyclerView';
  return nodes.filter((node) => node.resourceId === id('search_list_layout') && recycler(node)).filter((list) => {
    // A foreign native subtree cannot disappear into a known list variant after Maps-only filtering.
    if (list.foreignDescendant) return false;
    const panel = nodes.find((node) => node.resourceId === id('content_container') && node.enabled && withinMaps(list, node));
    if (!panel || !nodes.some((node) => node.resourceId === id('custom_slider_container') && node.enabled && withinMaps(panel, node))) return false;
    const header = nodes.filter((node) => withinMaps(node, panel) && !withinMaps(node, list));
    if (!header.some((node) => node.enabled && node.heading && node.className === 'android.widget.TextView' && hasLabel(node, [query])) ||
        !header.some((node) => node.enabled && node.clickable && node.resourceId === id('terra_navigation_header_close_button') && hasLabel(node, ['close']))) return false;
    const descendants = nodes.filter((node) => withinMaps(node, list));
    const filters = descendants.some((node) => node.resourceId === id('recycler_view') && recycler(node) &&
      controls(descendants.filter((child) => withinMaps(child, node)), ['more filters', 'relevance', 'open now']));
    const actionNames = ['directions', 'call', 'website', 'menu', 'share', 'save'];
    const actions = descendants.some((node) => {
      if (!node.enabled || !node.scrollable || node.className !== 'android.widget.HorizontalScrollView') return false;
      const actions = descendants.filter((child) => withinMaps(child, node))
        .map((child) => controlLabel(child, actionNames)).filter((label) => label !== null);
      return new Set(actions).size >= 2;
    });
    const hasPhotoResultAnchors = descendants.some(node => labels(node).some(label => (normalized(label).startsWith('image result for ') || normalized(label) === 'view photo map')));
    if (filters && actions && !hasPhotoResultAnchors) return true;
    // In the observed scrolled body the filter RecyclerView is offscreen. Only
    // direct, visible native card containers with their own action row qualify;
    // anonymous map nodes or another horizontal recycler cannot replace them.
    const direct = descendants.filter(node => node.parent === list);
    const cards = direct.filter(node => node.enabled && node.packageName === MAPS_PACKAGE && node.bounds !== null &&
      node.className === 'android.widget.FrameLayout' && !node.resourceId && !labels(node).length &&
      node.bounds.left === list.bounds!.left && node.bounds.right === list.bounds!.right &&
      node.bounds.top >= list.bounds!.top && node.bounds.bottom <= list.bounds!.bottom);
    if (scrolledPhotoModuleContinuation(nodes, list, exactKeyword) || filteredPhotoModuleList(nodes, list, exactKeyword)) return true;
    // The observed tall first ad can fill the collapsed sheet before its action
    // row is visible. Require the native filter row and the paired ad controls
    // in that one clipped direct card; an anonymous card is insufficient.
    const tallCard = cards.length === 1 && direct.length === 2 && cards[0] === direct[1] ? cards[0] : undefined;
    if (filters && tallCard?.bounds && tallCard.bounds.bottom === list.bounds!.bottom &&
      direct[0]?.enabled && direct[0].className === 'android.widget.LinearLayout' &&
      descendants.some(node => node.resourceId === id('recycler_view') && withinMaps(node, direct[0]!)) &&
      list.actions?.includes('ACTION_SCROLL_TO_POSITION') && list.actions.includes('ACTION_SCROLL_FORWARD') &&
      !list.actions.includes('ACTION_SCROLL_BACKWARD')) {
      const markers = descendants.filter(node => node.enabled && node.className === 'android.view.ViewGroup' &&
        node.bounds !== null && withinMaps(node, tallCard) && hasLabel(node, ['sponsored']));
      const disclosures = descendants.filter(node => node.enabled && node.clickable && node.className === 'android.view.ViewGroup' &&
        node.bounds !== null && withinMaps(node, tallCard) && hasLabel(node, ['about this ad']));
      if (markers.length === 1 && disclosures.length === 1) {
        const marker = markers[0]!;
        const disclosure = disclosures[0]!;
        const body = marker.parent;
        const contained = (node: EvidenceNode): boolean => node.bounds!.left >= tallCard.bounds!.left &&
          node.bounds!.right <= tallCard.bounds!.right && node.bounds!.top >= tallCard.bounds!.top &&
          node.bounds!.bottom <= tallCard.bounds!.bottom;
        if (body && disclosure.parent === body && body.enabled && body.clickable && body.className === 'android.view.ViewGroup' &&
          body.parent?.parent === tallCard && contained(marker) && contained(disclosure) &&
          marker.bounds!.top < disclosure.bounds!.bottom && disclosure.bounds!.top < marker.bounds!.bottom &&
          !livePhotoDiscovery(nodes, query, exactKeyword)) return true;
      }
    }
    const cardActions = cards.some(card => descendants.some(row => withinMaps(row, card) && row.enabled && row.scrollable &&
      row.className === 'android.widget.HorizontalScrollView' && new Set(descendants.filter(child => withinMaps(child, row))
        .map(child => controlLabel(child, actionNames)).filter(label => label !== null)).size >= 2));
    return !hasPhotoResultAnchors && direct.length > 0 && cards.length === direct.length && cardActions &&
      list.actions !== null && list.actions.includes('ACTION_SCROLL_TO_POSITION') &&
      list.actions.some(action => ['ACTION_SCROLL_FORWARD', 'ACTION_SCROLL_BACKWARD'].includes(action)) &&
      !livePhotoDiscovery(nodes, query, exactKeyword);
  });
}

/** A separate unranked search layout observed on Maps 26.41, not a ranked list. */
function livePhotoDiscovery(nodes: EvidenceNode[], query: string, exactKeyword = query): boolean {
  if (!query) return false;
  const id = (name: string): string => `${MAPS_PACKAGE}:id/${name}`;
  return nodes.filter(node => node.resourceId === id('search_list_layout') && node.enabled && node.scrollable && node.bounds !== null
    && node.className === 'android.support.v7.widget.RecyclerView').some(list => {
    const panel = nodes.find(node => node.resourceId === id('content_container') && node.enabled && withinMaps(list, node));
    if (!panel || !nodes.some(node => node.resourceId === id('custom_slider_container') && node.enabled && withinMaps(panel, node))) return false;
    const header = nodes.filter(node => withinMaps(node, panel) && !withinMaps(node, list));
    if (!header.some(node => node.enabled && node.heading && node.className === 'android.widget.TextView' && hasLabel(node, [query]))
      || !header.some(node => node.enabled && node.clickable && node.resourceId === id('terra_navigation_header_close_button') && hasLabel(node, ['close']))) return false;
    if (scrolledPhotoModuleContinuation(nodes, list, exactKeyword) || filteredPhotoModuleList(nodes, list, exactKeyword)) return false;
    const descendants = nodes.filter(node => withinMaps(node, list));
    const rows = descendants.filter(node => node.enabled && node.scrollable && node.bounds !== null && node.className === 'android.widget.HorizontalScrollView');
    const actions = rows.some(row => {
      const names = new Set(descendants.filter(node => node.enabled && node.clickable && node.bounds !== null && withinMaps(node, row))
        .flatMap(node => {
          const matches = [...new Set(labels(node).map(normalized).filter(label => ['directions', 'order', 'menu', 'share'].includes(label)))];
          return matches.length === 1 ? matches : [];
        }));
      return names.has('directions') && (names.has('order') || names.has('menu')) && names.size >= 3;
    });
    const imagePrefix = `image result for ${query} posted by `;
    const gallery = rows.some(row => {
      const photos = descendants.filter(node => node.enabled && node.bounds !== null && node.className === 'android.widget.ImageView'
        && normalized(node.description).startsWith(imagePrefix) && normalized(node.description).length > imagePrefix.length
        && withinMaps(node, row) && node.parent?.packageName === MAPS_PACKAGE && node.parent.enabled && node.parent.clickable
        && node.parent.className === 'android.view.ViewGroup');
      return photos.length >= 2;
    });
    // The visible screenshot supplies the photo-discovery context; the hierarchy
    // does not expose its merchant name/title reliably. No identity/rank inferred.
    return actions && gallery;
  });
}

/** Shared UI/reader proof for a top-clipped module control beside a proven merchant.
 * The reconciler still has to join this fragment to prior exact-query image evidence.
 */
export function inspectNativePhotoModuleTail(xml: string, keyword: string): UiNode['bounds'] {
  const nodes = parseEvidence(xml).filter(node => node.packageName === MAPS_PACKAGE);
  const lists = liveSearchLists(nodes, normalized(keyword), keyword);
  if (lists.length !== 1) return null;
  const list = lists[0]!, first = nodes.find(node => node.parent === list);
  if (!first?.bounds || first.bounds.top !== list.bounds?.top || !nativePhotoMapTail(nodes, first) ||
    !scrolledPhotoModuleContinuation(nodes, list, keyword)) return null;
  return first.bounds;
}

/** Conservative English hints; the real-fixture branch validates screenshot layout only. */
export function analyzeScreen(xml: string, keyword: string): ScreenAnalysis {
  const allNodes = parseEvidence(xml);
  const texts = allNodes.flatMap(labels); // Keep repeated text; repeats are not deduplicated places.
  const nodes = allNodes.filter((node) => node.packageName === MAPS_PACKAGE);
  const queryVisible = nodes.some((node) => queryMatches(node, normalized(keyword)));
  const adLabels = nodes.flatMap(labels).filter((label) => ['ad', 'ads', 'sponsored', 'paid advertisement'].includes(normalized(label)));
  const warnings = [
    'Ranking is not evaluated; text order and repeated text are not place identities or ranks.',
    'Visible ad labels are evidence only; advertisement coverage is not evaluated.',
  ];
  const has = (values: string[]): boolean => nodes.some((node) => hasLabel(node, values));
  const control = (values: string[]): boolean => nodes.some((node) => node.enabled && node.clickable && hasLabel(node, values));
  const loading = nodes.some((node) => /(?:ProgressBar|CircularProgressIndicator|LinearProgressIndicator)$/.test(node.className) ||
    (/(?:^|\/)(?:loading|loading_text|loading_indicator|progress_indicator|search_progress)$/.test(node.resourceId) &&
      labels(node).some((label) => /^(?:loading(?: results)?|searching)(?:\.{3}|…)?$/.test(normalized(label)))));
  const dialog = nodes.some((node) => /(?:Dialog|WebView)$/.test(node.className) || /(?:captcha|consent)_dialog$/.test(node.resourceId));
  const challenge = dialog && has(['verify you are human', 'unusual traffic', 'too many requests']) &&
    (control(["i'm not a robot", 'verify', 'try again']) || has(['try again later']));
  const consent = dialog && has(['before you continue to google', 'welcome to google maps']) &&
    has(['privacy', 'privacy policy', 'terms', 'terms of service']) && control(['accept all', 'reject all', 'i agree']);
  const detailActions = ['directions', 'call', 'website', 'save'].filter((label) => control([label])).length;
  const detailTabs = ['overview', 'reviews', 'photos', 'about'].filter((label) => control([label])).length;
  const detail = detailActions >= 2 && detailTabs >= 2 && nodes.some((node) =>
    /(?:^|\/)(?:title|place_name|place_title|header_title)$/.test(node.resourceId) && node.text.trim());
  const resultList = nodes.some((node) =>
    (/(?:RecyclerView|ListView)$/.test(node.className) || node.scrollable) &&
    (/(?:^|\/)(?:search_results_list|search_results|results_list)$/.test(node.resourceId) || hasLabel(node, ['search results'])));
  const resultCard = nodes.some((node) => node.clickable && /(?:^|\/)(?:result_card|result_row|place_result)$/.test(node.resourceId));
  const livePanel = queryVisible && liveSearchLists(nodes, normalized(keyword), keyword).length === 1;
  const photoDiscovery = queryVisible && livePhotoDiscovery(nodes, normalized(keyword), keyword);
  const results = livePanel || (queryVisible && resultList && resultCard && control(['filters', 'sort', 'open now']));
  const noResults = queryVisible && !resultList && !detail &&
    nodes.some((node) => /(?:^|\/)(?:empty_results_message|no_results_message|empty_state_message)$/.test(node.resourceId) &&
      hasLabel(node, ['no results', 'no results found', 'no results found in this area'])) &&
    has(['try a different search', 'try searching for something else', 'try another search']);

  let kind: ScreenKind = 'unknown';
  if (challenge && !consent) kind = 'blocked';
  else if (consent && !challenge) kind = 'consent';
  else if (!challenge && !consent) {
    const candidates = [detail && 'detail', results && 'results', photoDiscovery && 'photo_discovery', noResults && 'no_results'].filter(Boolean) as ScreenKind[];
    if (candidates.length === 1) kind = candidates[0]!;
  }
  if (loading && kind !== 'blocked' && kind !== 'consent') {
    kind = 'unknown';
    warnings.push('A visible loading indicator prevents treating this screen as settled evidence.');
  }
  if (!nodes.length) warnings.push('No visible Maps-owned nodes; foreground must be verified independently.');
  if (photoDiscovery) warnings.push('Observed photo discovery search evidence; merchant identity and semantic ranks remain not_evaluated.');
  warnings.push(livePanel || photoDiscovery
    ? 'Screenshot capture layout compatibility is validated for the supplied Google Maps 26.41 search screens only; semantic ranks remain not_evaluated.'
    : 'Screen heuristics use synthetic fixtures; live Google Maps layout compatibility is unverified.');
  if (!queryVisible) warnings.push('Exact query was not verified in an enabled Maps search field.');
  if (kind === 'unknown') warnings.push('Screen state is unknown or ambiguous and requires review.');
  return { kind, queryVisible, texts, adLabels, warnings };
}


export interface NativeResultList {
  resourceId: string;
  bounds: NonNullable<UiNode['bounds']>;
  canScrollBackward: boolean | null;
  canScrollForward: boolean | null;
  sheetHandleBounds: UiNode['bounds'];
  expansionTargetY: number | null;
}

/** Exact-query gesture proof for the observed list; never includes the filter recycler. */
export function inspectNativeResultList(xml: string, exactKeyword: string): NativeResultList | null {
  if (analyzeScreen(xml, exactKeyword).kind !== 'results') return null;
  const nodes = parseEvidence(xml).filter(node => node.packageName === MAPS_PACKAGE);
  const queryFields = nodes.filter(node => node.enabled && /^com\.google\.android\.apps\.maps:id\/search_omnibox_(?:text_box(?:_search)?|edit_text)$/.test(node.resourceId) &&
    (node.text === exactKeyword || (node.text === '' && node.description === exactKeyword)));
  if (queryFields.length !== 1) return null;
  const lists = liveSearchLists(nodes, normalized(exactKeyword), exactKeyword);
  if (lists.length !== 1) return null;
  const list = lists[0]!;
  const panel = nodes.find(node => node.resourceId === `${MAPS_PACKAGE}:id/content_container` && node.enabled && withinMaps(list, node));
  const slider = panel && nodes.find(node => node.resourceId === `${MAPS_PACKAGE}:id/custom_slider_container` && node.enabled && withinMaps(panel, node));
  const handles = nodes.filter(node => node.enabled && node.resourceId === `${MAPS_PACKAGE}:id/grippy` &&
    node.className === 'android.widget.FrameLayout' && node.bounds !== null && panel?.bounds && slider && withinMaps(node, slider) &&
    node.bounds.left >= panel.bounds.left && node.bounds.right <= panel.bounds.right &&
    node.bounds.top >= panel.bounds.top && node.bounds.bottom < list.bounds!.top &&
    node.parent?.enabled && node.parent.className === 'android.widget.FrameLayout' && node.parent.bounds &&
    node.parent.bounds.top === panel.bounds.top && node.parent.bounds.bottom === panel.bounds.bottom);
  const handle = handles.length === 1 ? handles[0]!.bounds : null;
  const field = queryFields[0]!;
  const target = handle && field.bounds ? field.bounds.top + Math.min(16, handle.bottom - handle.top) : null;
  const hasActions = list.actions?.includes('ACTION_SCROLL_TO_POSITION') === true;
  return {
    resourceId: list.resourceId, bounds: { ...list.bounds! },
    canScrollBackward: hasActions ? list.actions!.includes('ACTION_SCROLL_BACKWARD') : null,
    canScrollForward: hasActions ? list.actions!.includes('ACTION_SCROLL_FORWARD') : null,
    sheetHandleBounds: handle ? { ...handle } : null,
    expansionTargetY: target !== null && target >= 0 && target < list.bounds!.top ? target : null,
  };
}
