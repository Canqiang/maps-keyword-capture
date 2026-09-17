import type { BlobGateway } from '../../src/storage/blob-gateway.js';

export class FakeGateway implements BlobGateway {
  readonly description = 'fake://maps-keyword-capture';
  readonly objects = new Map<string, Buffer>();
  readonly calls: string[] = [];
  failOn: (op: 'create' | 'put' | 'get', key: string) => boolean = () => false;
  corruptGet: (key: string) => boolean = () => false;

  async createIfAbsent(key: string, data: Buffer): Promise<'created' | 'exists'> {
    this.calls.push(`create ${key}`);
    if (this.failOn('create', key)) throw new Error(`create ${key} failed: https://x.blob.core.windows.net/c?sv=1&sig=SECRET`);
    if (this.objects.has(key)) return 'exists';
    this.objects.set(key, Buffer.from(data));
    return 'created';
  }

  async put(key: string, data: Buffer): Promise<void> {
    this.calls.push(`put ${key}`);
    if (this.failOn('put', key)) throw new Error(`put ${key} failed`);
    this.objects.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer> {
    this.calls.push(`get ${key}`);
    if (this.failOn('get', key)) throw new Error(`get ${key} failed`);
    const data = this.objects.get(key);
    if (!data) throw new Error(`get ${key} failed: not found`);
    return this.corruptGet(key) ? Buffer.concat([data, Buffer.from('x')]) : Buffer.from(data);
  }
}
