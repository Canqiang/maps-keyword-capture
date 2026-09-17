import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { createStore, parseStorageArg, parseStorageFlag } from '../src/storage/factory.js';

describe('storage selection', () => {
  it('parses the --storage flag', () => {
    expect(parseStorageFlag(null)).toBe('local');
    expect(parseStorageFlag('local')).toBe('local');
    expect(parseStorageFlag('azure')).toBe('azure');
    expect(() => parseStorageFlag('s3')).toThrow(ConfigError);
  });

  it('builds a local store without credentials and a remote store only with them', () => {
    const local = createStore('local', './outputs', {});
    expect(local.store.mode).toBe('local_only');
    expect(local.description).toBeNull();
    expect(() => createStore('azure', './outputs', {})).toThrow(ConfigError);
    const remote = createStore('azure', './outputs', { AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' });
    expect(remote.store.mode).toBe('azure_blob');
    expect(remote.description).toBe('http://127.0.0.1:10000/devstoreaccount1/maps-keyword-capture');
  });

  it('parses --storage from argv strictly', () => {
    expect(parseStorageArg(['--config', 'k.json'])).toBe('local');
    expect(parseStorageArg(['--config', 'k.json', '--storage', 'azure'])).toBe('azure');
    expect(parseStorageArg(['--storage', 'local', '--config', 'k.json'])).toBe('local');
    expect(() => parseStorageArg(['--config', 'k.json', '--storage=azure'])).toThrow(ConfigError);
    expect(() => parseStorageArg(['--config', 'k.json', '--storage'])).toThrow(ConfigError);
    expect(() => parseStorageArg(['--storage', '--config', 'k.json'])).toThrow(ConfigError);
    expect(() => parseStorageArg(['--storage', 's3'])).toThrow(ConfigError);
  });
});
