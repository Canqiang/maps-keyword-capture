import { ConfigError } from '../config.js';
import { keywordKey } from './model.js';
import type { StoredStore } from './repository.js';
import { parseStore, type TrackingStore } from './tracking-config.js';

export interface TargetCatalog { schemaVersion: 'tracking-target-catalog/v1'; version: string; stores: TrackingStore[] }

export function parseTargetCatalog(raw: unknown): TargetCatalog {
  if (!raw || typeof raw !== 'object') throw new ConfigError('invalid target catalog');
  const catalog = raw as Record<string, unknown>;
  if (catalog.schemaVersion !== 'tracking-target-catalog/v1' || typeof catalog.version !== 'string' || !catalog.version || !Array.isArray(catalog.stores) || !catalog.stores.length) throw new ConfigError('invalid target catalog header');
  const stores = catalog.stores.map(parseStore);
  if (new Set(stores.map(s => s.storeId)).size !== stores.length || new Set(stores.map(s => s.placeId)).size !== stores.length) throw new ConfigError('target catalog repeats a store identity');
  if (stores.some(s => !s.keywordTargets || !s.fixedPoints || s.monitoringCatalog?.version !== catalog.version)) throw new ConfigError('target catalog stores must carry matching version, points and targets');
  // An approved report maps every monitored keyword to every fixed point and draws it from the store's inventory.
  for (const store of stores) {
    const inventory = new Set([...store.keywords.core, ...store.keywords.longTail].map(keywordKey));
    for (const target of store.keywordTargets!) {
      if (!inventory.has(keywordKey(target.keyword))) throw new ConfigError(`store ${store.storeId} target keyword is missing from its keyword inventory`);
      if (target.pointTargets.length !== store.fixedPoints!.length) throw new ConfigError(`store ${store.storeId} target points must cover every fixed point in a catalog`);
    }
  }
  return { schemaVersion: 'tracking-target-catalog/v1', version: catalog.version, stores };
}

/**
 * Resolve identity by Place ID before saving anything. The caller upserts only these stores:
 * unrelated stores, shared SEO collections and all observation documents remain untouched.
 * Older keywords stay in the inventory; keywordTargets defines the active sampling scope.
 */
export function reconcileTargetStores(existing: readonly StoredStore[], catalog: TargetCatalog): TrackingStore[] {
  const byPlaceId = new Map(existing.map(s => [s.placeId, s]));
  if (byPlaceId.size !== existing.length) throw new ConfigError('existing stores repeat a Place ID; resolve identities before importing');
  return catalog.stores.map(incoming => {
    const previous = byPlaceId.get(incoming.placeId);
    const storeId = previous?.storeId ?? incoming.storeId;
    if (existing.some(s => s.storeId === storeId && s.placeId !== incoming.placeId)) throw new ConfigError(`store ID ${storeId} already belongs to another Place ID`);
    if (!previous) return parseStore(incoming);
    const { createdAt: _created, updatedAt: _updated, ...old } = previous;
    const core = [...old.keywords.core];
    const longTail = [...old.keywords.longTail];
    const seen = new Set([...core, ...longTail].map(keywordKey));
    for (const keyword of [...incoming.keywords.core, ...incoming.keywords.longTail]) {
      if (!seen.has(keywordKey(keyword))) { longTail.push(keyword); seen.add(keywordKey(keyword)); }
    }
    return parseStore({ ...old, ...incoming, storeId,
      ...(old.merchantId ? { merchantId: old.merchantId } : {}),
      aliases: [...new Set([...old.aliases, ...incoming.aliases])], keywords: { core, longTail } });
  });
}
