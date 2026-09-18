import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfigFile, parseConfig } from '../src/config.js';

const valid = {
  schemaVersion: '1',
  keywords: ['bubble tea garden city', 'matcha mineola'],
  maxResultsPerKeyword: 15,
  maxScrollsPerKeyword: 6,
  maxScreenshotsPerKeyword: 5,
  keywordTimeoutMs: 90000,
  locale: 'en-US',
  browserTimezoneId: 'America/New_York',
  filenameTimezone: 'Asia/Shanghai',
  viewport: { width: 1440, height: 1000 },
  outputDirectory: './outputs',
};

describe('config', () => {
  it('parses the example file', async () => {
    const loaded = await loadConfigFile('examples/keywords.json');
    expect(loaded.config.maxResultsPerKeyword).toBe(15);
    expect(loaded.config.keywords.length).toBeGreaterThan(0);
    expect(loaded.duplicateKeywordCount).toBe(0);
  });

  it('applies defaults for omitted limits', () => {
    const { config } = parseConfig({ schemaVersion: '1', keywords: ['a'], outputDirectory: './out' });
    expect(config.maxResultsPerKeyword).toBe(15);
    expect(config.maxScrollsPerKeyword).toBe(6);
    expect(config.maxScreenshotsPerKeyword).toBe(5);
    expect(config.keywordTimeoutMs).toBe(90000);
    expect(config.viewport).toEqual({ width: 1440, height: 1000 });
    expect('mapView' in config).toBe(false);
  });

  it('rejects the reserved mapView field with a clear message', () => {
    expect(() => parseConfig({ ...valid, mapView: { latitude: 1, longitude: 2, zoom: 3 } }))
      .toThrowError(/mapView/);
  });

  it('rejects unknown fields, empty keywords, and invalid timezones', () => {
    expect(() => parseConfig({ ...valid, typo: 1 })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: [] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: ['  '] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, filenameTimezone: 'Mars/Olympus' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })).toThrow(ConfigError);
  });

  it('keeps duplicate keywords and counts them', () => {
    const loaded = parseConfig({ ...valid, keywords: ['a', 'a', 'b'] });
    expect(loaded.config.keywords).toEqual(['a', 'a', 'b']);
    expect(loaded.duplicateKeywordCount).toBe(1);
  });

  it('reports unreadable files as ConfigError', async () => {
    await expect(loadConfigFile('does-not-exist.json')).rejects.toThrow(ConfigError);
  });
});

const expectedArea = { label: 'Mineola, NY', latitude: 40.75, longitude: -73.64, radiusKm: 10, source: 'Verified store registry' };
describe('passive geographic validation config', () => {
  it('preserves the declared area without enabling a map view or changing keywords', () => {
    const result = parseConfig({ ...valid, expectedArea }).config;
    expect(result.expectedArea).toEqual(expectedArea);
    expect(result.keywords).toEqual(valid.keywords);
    expect(result.mapView).toBeUndefined();
  });
  it.each([
    { latitude: 91 }, { latitude: -91 }, { latitude: NaN }, { longitude: 181 },
    { longitude: -181 }, { longitude: Infinity }, { radiusKm: 0 }, { radiusKm: -1 },
    { radiusKm: Infinity }, { label: '  ' }, { source: '' }, { source: '  ' }, { extra: true },
  ])('rejects unusable or unproven area %j', patch => {
    expect(() => parseConfig({ ...valid, expectedArea: { ...expectedArea, ...patch } })).toThrow(ConfigError);
  });
});
