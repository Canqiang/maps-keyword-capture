import { describe, expect, it } from 'vitest';
import { parseAndroidConfig } from '../src/android/config.js';
const valid = () => ({ schemaVersion: 'android-maps-input/v1', serial: 'emulator-5554', tasks: [{ storeId: 'keke', storeName: 'Keke', keyword: 'spicy duck neck', sourceReference: 'test fixture', location: { id: 'flushing-1', label: 'Test point', latitude: 40.76, longitude: -73.83, source: 'test fixture' } }] });
describe('Android input isolation and bounds', () => {
  it('produces an explicit Android profile and preserves exact keyword', () => { const c = parseAndroidConfig(valid()); expect(c.locale).toBe('en-US'); expect(c.tasks[0]?.keyword).toBe('spicy duck neck'); expect(c.maxScreenshotsPerQuery).toBe(60); });
  it.each(['http://remote:4723','http://user:secret@localhost:4723','http://127.0.0.1:4723/?token=x','https://example.com'])('rejects nonlocal or credential-bearing Appium %s', appiumUrl => { expect(() => parseAndroidConfig({...valid(), appiumUrl})).toThrow(); });
  it.each(['device123','emulator-5554;rm','../emulator-5554','emulator-123456'])('requires an explicit emulator serial %s', serial => { expect(() => parseAndroidConfig({...valid(), serial})).toThrow(); });
  it('rejects invalid point and oversized run', () => { const bad=valid(); bad.tasks[0]!.location.latitude=100; expect(() => parseAndroidConfig(bad)).toThrow(); expect(() => parseAndroidConfig({...valid(),tasks:Array(21).fill(valid().tasks[0])})).toThrow(); });
  it('rejects duplicate store query location tasks and silent unknown settings', () => { expect(() => parseAndroidConfig({...valid(),tasks:[valid().tasks[0],valid().tasks[0]]})).toThrow(); expect(() => parseAndroidConfig({...valid(),mapView:{}})).toThrow(); });
  it('rejects blank or multiline keyword, unsafe filenames and timezone', () => { for(const keyword of [' ', 'a\nb']) { const v=valid();v.tasks[0]!.keyword=keyword;expect(()=>parseAndroidConfig(v)).toThrow(); } expect(()=>parseAndroidConfig({...valid(),timezone:'not-a-zone'})).toThrow(); const v=valid();v.tasks[0]!.storeId='../bad'; expect(()=>parseAndroidConfig(v)).toThrow(); });
});

describe('Android bounded listing capture configuration',()=>{
 it('targets fifteen displayed results with enough bounded frames and time for native OCR',()=>{
  const c=parseAndroidConfig(valid());
  expect(c.maxDisplayedResults).toBe(15);expect(c.maxScrolls).toBe(59);
  expect(c.maxScreenshotsPerQuery).toBe(60);expect(c.keywordTimeoutMs).toBe(600000);
  expect(c.ocrLanguages).toBe('eng+chi_sim+chi_tra');expect(c.ocrTimeoutMs).toBe(15000);
 });
 it.each([{maxDisplayedResults:0},{maxDisplayedResults:51},{maxScrolls:100},{maxScreenshotsPerQuery:101},{ocrTimeoutMs:60001},{ocrLanguages:'eng;bad'},{keywordTimeoutMs:600001}])('rejects unbounded or unsafe extraction options %j',settings=>{
  expect(()=>parseAndroidConfig({...valid(),...settings})).toThrow();
 });
});
