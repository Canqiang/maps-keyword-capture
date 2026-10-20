import { describe, expect, it } from 'vitest';
import { createFrontendModel } from '../src/web/frontend-model.js';
const m = createFrontendModel();
const o = (id: string, day: string, rank: number | null = 4, extra: Record<string, unknown> = {}) => ({
 observationId: id, localDate: day, observedAt: day + 'T12:00:00Z', keyword: 'duck neck', keywordKey: 'duck neck',
 eligible: true, metricOrganicRank: rank, cohortKey: 'one', rank: { status: rank === null ? 'not_found' : 'ranked', organicRank: rank }, ...extra,
});
describe('frontend history presentation', () => {
 it('uses latest attempt including failure and retains all exact daily identities', () => {
  const good = o('old', '2026-10-19'); const failed = o('new', '2026-10-19', null, { observedAt: '2026-10-19T14:00:00Z', eligible: false, rank: { status: 'failed', organicRank: null } });
  const days = m.daily([failed, good]);
  expect(days['2026-10-19']?.[0]?.observationId).toBe('new');
  expect(days['2026-10-19']).toHaveLength(2);
  expect(m.present(failed).label).toBe('采集失败');
 });
 it('does not manufacture qualified ranks, absence penalties, or comparable deltas', () => {
  expect(m.present(o('a','2026-10-19',3,{eligible:false}))).toMatchObject({label:'观测 3', qualified:false});
  expect(m.present(o('a','2026-10-19',null)).label).toBe('确认未见');
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4))).toMatchObject({comparable:true,delta:5});
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4,{cohortKey:'changed'}))).toMatchObject({comparable:false,delta:null});
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4,{eligible:false})).delta).toBeNull();
 });
 it('breaks trends at missing dates, latest failures and changed cohorts', () => {
  const rows = [o('a','2026-10-16',9),o('b','2026-10-17',8),o('c','2026-10-19',7),o('d','2026-10-20',6,{cohortKey:'new'}),o('e','2026-10-21',5,{eligible:false})];
  expect(m.segments(rows).map(s=>s.map(x=>x.observationId))).toEqual([['a','b'],['c'],['d']]);
 });
 it('preserves evidence identity and safely encodes only supported evidence keys', () => {
  expect(m.evidenceUrl('tracking/web/past/a.png')).toBe('/api/evidence?key=tracking%2Fweb%2Fpast%2Fa.png');
  for(const key of ['/etc/secret.png','tracking/../secret.png','https://x/a.png','tracking/a.json','tracking/x.png?sig=secret']) expect(m.evidenceUrl(key)).toBeNull();
  expect(m.escape('<img onerror="x">')).toBe('&lt;img onerror=&quot;x&quot;&gt;');
 });
 it('handles an inclusive bounded calendar without timezone shifts', () => {
  expect(m.days('2026-10-19','2026-10-21')).toEqual(['2026-10-19','2026-10-20','2026-10-21']);
  expect(m.days('2026-10-21','2026-10-19')).toEqual([]);
 });
});

import { Script, runInNewContext } from 'node:vm';
import { UI_HTML } from '../src/web/ui.js';
describe('served frontend runtime', () => {
 it('ships syntactically valid executable script, including the shared pure model', () => {
  const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(() => new Script(script!)).not.toThrow();
  const setup = script!.slice(0, script!.indexOf('const E=M.escape'));
  expect(runInNewContext(setup+'M.present({eligible:false,rank:{status:"failed",organicRank:null}}).label')).toBe('采集失败');
 });
});
