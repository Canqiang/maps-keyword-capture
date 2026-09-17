/** The three blob operations the collector needs; one implementation per provider. */
export interface BlobGateway {
  /** Container URL without any query string, safe to log. */
  readonly description: string;
  /** Upload only if no object exists at the key. */
  createIfAbsent(key: string, data: Buffer, contentType: string): Promise<'created' | 'exists'>;
  /** Upload, replacing any existing object. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Download the full object. */
  get(key: string): Promise<Buffer>;
}

export function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jsonl')) return 'application/x-ndjson';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}
