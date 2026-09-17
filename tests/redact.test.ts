import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/storage/redact.js';

describe('redactSecrets', () => {
  it('removes SAS signatures and account keys but keeps the rest readable', () => {
    const sas = 'https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?sv=2025-01-05&si=maps-capture-writer&sr=c&sig=AbC%2Fd1%2B2%3D&spr=https';
    expect(redactSecrets(`upload to ${sas} failed`)).toBe('upload to https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture?sv=2025-01-05&si=maps-capture-writer&sr=c&sig=REDACTED&spr=https failed');
    expect(redactSecrets('DefaultEndpointsProtocol=https;AccountName=a;AccountKey=abc+/==;EndpointSuffix=core.windows.net'))
      .toBe('DefaultEndpointsProtocol=https;AccountName=a;AccountKey=REDACTED;EndpointSuffix=core.windows.net');
    expect(redactSecrets('nothing secret here')).toBe('nothing secret here');
  });
});
