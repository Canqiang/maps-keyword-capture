import { createHash } from 'node:crypto';
interface CachedImage { body: Buffer; etag: string; expiresAt: number }
/** Per-process, bounded cache. Authorization belongs to the HTTP handler, before every lookup. */
export class EvidenceCache {
  private entries = new Map<string, CachedImage>();
  private inflight = new Map<string, Promise<CachedImage>>();
  bytes = 0;
  constructor(private reader: {get(key: string): Promise<Buffer>}, private maxBytes = 64 * 1024 * 1024,
    private ttlMs = 300_000, private now = () => Date.now()) {}
  async get(key: string): Promise<CachedImage> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      if (hit.expiresAt > this.now()) { this.entries.set(key, hit); return hit; }
      this.bytes -= hit.body.length;
    }
    const pending = this.inflight.get(key); if (pending) return pending;
    const load = this.load(key); this.inflight.set(key, load);
    try { return await load; } finally { this.inflight.delete(key); }
  }
  private async load(key: string): Promise<CachedImage> {
    const body = await this.reader.get(key);
    const image = {body, etag: '"'+createHash('sha256').update(body).digest('hex')+'"', expiresAt:this.now()+this.ttlMs};
    if (body.length <= this.maxBytes) {
      while (this.entries.size && this.bytes + body.length > this.maxBytes) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.body.length; this.entries.delete(oldest);
      }
      this.entries.set(key, image); this.bytes += body.length;
    }
    return image;
  }
}
