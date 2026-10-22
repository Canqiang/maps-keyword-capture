import { MongoClient, type MongoClientOptions } from 'mongodb';

/** One SEO keyword as the operation-assistant keyword library stores it. */
export interface SeoKeyword { keyword: string; priority: string; surfaces: string[] }
export interface SeoStore {
  placeId: string; merchantId: string | null; name: string; keywordCount: number; updatedTime: string | null;
  /** Several library records claim this Place ID; importing is refused until the library is fixed. */
  ambiguous: boolean;
}
export interface SeoStoreKeywords extends SeoStore { keywords: SeoKeyword[] }

/** Read-only view of the SEO keyword library (seo-integration.local_keywords). Nothing is written back. */
export interface SeoKeywordLibrary {
  stores(): Promise<SeoStore[]>;
  store(placeId: string): Promise<SeoStoreKeywords | null>;
  close?(): Promise<void>;
}

const PLACE_ID = /^ChIJ[\w-]+$/u;
const PRIORITY: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Normalise raw library records: valid Google Place IDs only, keywords trimmed, deduplicated and ordered by priority. */
export function parseSeoLibrary(records: unknown[]): SeoStoreKeywords[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const raw of records) {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (typeof record.place_id !== 'string' || !PLACE_ID.test(record.place_id)) continue;
    groups.set(record.place_id, [...(groups.get(record.place_id) ?? []), record]);
  }
  const stores: SeoStoreKeywords[] = [];
  for (const [placeId, group] of groups) {
    const record = group[0]!;
    const seen = new Set<string>();
    const keywords: SeoKeyword[] = (Array.isArray(record.keywords) ? record.keywords : []).flatMap((item, index) => {
      const k = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const keyword = typeof k.keyword === 'string' ? k.keyword.trim().replace(/\s+/gu, ' ') : '';
      const key = keyword.normalize('NFKC').toLowerCase();
      if (!keyword || keyword.length > 200 || /[\x00-\x1f\x7f]/u.test(keyword) || seen.has(key)) return [];
      seen.add(key);
      return [{ keyword, priority: typeof k.priority === 'string' ? k.priority : '', surfaces: Array.isArray(k.target_surface_types) ? k.target_surface_types.filter((s): s is string => typeof s === 'string') : [], index }];
    }).sort((a, b) => (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) || a.index - b.index).map(({ index: _index, ...k }) => k);
    stores.push({
      placeId, merchantId: typeof record.merchant_id === 'string' && record.merchant_id ? record.merchant_id : null,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : placeId,
      keywordCount: keywords.length, updatedTime: typeof record.updated_time === 'string' ? record.updated_time : record.updated_time instanceof Date ? record.updated_time.toISOString() : null,
      ambiguous: group.length > 1, keywords,
    });
  }
  return stores.sort((a, b) => a.name.localeCompare(b.name));
}

export class MongoSeoKeywordLibrary implements SeoKeywordLibrary {
  private readonly client: MongoClient;
  constructor(private readonly options: { uri: string; database?: string; collection?: string; maxRecords?: number; timeoutMs?: number; createClient?: (uri: string, options: MongoClientOptions) => MongoClient }) {
    const t = options.timeoutMs ?? 15_000;
    const clientOptions: MongoClientOptions = { appName: 'maps-keyword-capture-seo-import', serverSelectionTimeoutMS: t, connectTimeoutMS: t, socketTimeoutMS: t };
    this.client = options.createClient ? options.createClient(options.uri, clientOptions) : new MongoClient(options.uri, clientOptions);
  }
  /** The UAT server rejects unindexed filtered queries, so the small library is read whole in _id order. */
  private async all(): Promise<SeoStoreKeywords[]> {
    const limit = this.options.maxRecords ?? 2000;
    const docs = await this.client.db(this.options.database ?? 'seo-integration').collection(this.options.collection ?? 'local_keywords')
      .find({}, { projection: { merchant_id: 1, place_id: 1, name: 1, keywords: 1, updated_time: 1 }, sort: { _id: 1 }, limit: limit + 1, maxTimeMS: this.options.timeoutMs ?? 15_000 }).toArray();
    if (docs.length > limit) throw new Error('SEO keyword library exceeds the import limit');
    return parseSeoLibrary(docs);
  }
  async stores() { return (await this.all()).map(({ keywords: _keywords, ...store }) => store); }
  async store(placeId: string) { return (await this.all()).find(s => s.placeId === placeId) ?? null; }
  async close() { await this.client.close(); }
}
