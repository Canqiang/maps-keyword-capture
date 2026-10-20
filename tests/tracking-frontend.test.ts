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


describe('grid geometry labels', () => {
 it('describes square edge distance and planned corner distance without claiming circular coverage', () => {
  const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)?.[1];
  const geometry = script!.match(/function gridGeometryText\(data\)\{[^\n]*\}/)?.[0];
  expect(geometry).toBeTruthy();
  const text = runInNewContext(geometry! + ';gridGeometryText({gridSpec:{size:5,radiusKm:5}})');
  expect(text).toBe('方形 5 × 5 采样；按网格规划估算，角点距中心约 7.1 km。');
  expect(runInNewContext(geometry! + ';gridGeometryText({})')).toBe('网格形状信息不可用。');
  expect(UI_HTML).toContain('中心至边缘：');
  expect(UI_HTML).toContain('网格中心至边缘 km（留空使用默认）');
  expect(UI_HTML).not.toContain('采集半径：');
  expect(UI_HTML).not.toContain('整个半径内的覆盖率');
 });
});

function renderEvidenceCard(row: Record<string, unknown>): string {
 const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
 const setup = script.slice(0, script.indexOf('const E=M.escape'));
 const declarations = ['const channel=', 'const when=', 'const badge=', 'function conditionRows(', 'function observationCard(']
  .map(prefix => script.split('\n').find(line => line.startsWith(prefix))!).join('\n');
 return runInNewContext(setup + '\nconst E=M.escape, settings={timezone:"America/New_York"};\n' + declarations + '\nobservationCard(row,"Selected evidence")', { row });
}

// Reduced from the real 2026-10-20 ENTER probe: the second item is the clipped
// Wonder card, not a proved second business. No screenshot bytes are embedded.
function unreliableAndroidCard() {
 return {
  observationId:'probe-order', keyword:'braised food', observedAt:'2026-10-20T14:16:49Z',
  surface:'android', pointId:'r+2c-2', locationMode:'device_gps', eligible:false, metricOrganicRank:null,
  rank:{status:'unreliable',organicRank:null,displayPosition:null,targetOccurrences:[],adDisplayPositions:[]},
  quality:{rankingReliable:false,sequenceVerified:false,classificationComplete:false,screenshotCoverageComplete:true,identityResolved:false,
   geographicRelevance:null,locationEvidence:{injectionStatus:'sent',deviceLocationStatus:'matched',mapsLocationStatus:'unverified'},
   warnings:['ordered_overlap_missing','unknown_cards_precede_organic_ranks']},
  topListings:[
   {displayPosition:1,organicRank:null,resultType:'ad',name:'Wonder Parkchester',rating:4.7,reviewCount:49},
   {displayPosition:2,organicRank:null,resultType:'unknown',name:null,rating:4.7,reviewCount:49},
   {displayPosition:3,organicRank:null,resultType:'ad',name:'Sugar Restaurant',rating:4.7,reviewCount:1696},
  ],
  evidence:{screenshotKeys:['android-maps/2026-10-20/probe/frame-001.png','android-maps/2026-10-20/probe/frame-002.png']},
 };
}

describe('evidence card ordering and location semantics', () => {
 it.each([
  {sequenceVerified:false,screenshotCoverageComplete:true},
  {sequenceVerified:true,screenshotCoverageComplete:false},
  {sequenceVerified:undefined,screenshotCoverageComplete:true},
  {sequenceVerified:true,screenshotCoverageComplete:undefined},
 ])('labels unverified ordering as raw record numbers while retaining all rows and exact screenshot references: %j', quality => {
  const row=unreliableAndroidCard();
  const html=renderEvidenceCard({...row,quality:{...row.quality,...quality}});
  expect(html).toContain('<th>原始记录序号（待核）</th>');
  expect(html).not.toContain('<th>含广告顺序</th>');
  expect(html).toContain('序号不是已验证的显示顺序或排名');
  expect(html).toContain('<td>1</td><td>—</td>');
  expect(html).toContain('<td>2</td><td>—</td>');
  expect(html).toContain('<td>3</td><td>—</td>');
  expect(html).toContain('Wonder Parkchester');
  expect(html).toContain('名称不可用');
  expect(html).toContain('Sugar Restaurant');
  for(const key of row.evidence.screenshotKeys) expect(html).toContain(m.evidenceUrl(key)!);
 });
 it('does not turn unverified target appearances or ad positions into confirmed display positions', () => {
  const row=unreliableAndroidCard();
  const html=renderEvidenceCard({...row,rank:{...row.rank,displayPosition:3,adDisplayPositions:[3]}});
  expect(html).toContain('<span>本店原始记录序号（待核）</span><b>3</b>');
  expect(html).toContain('<span>本店广告记录序号（待核）</span><b>3</b>');
  expect(html).not.toContain('<span>首次显示顺序（含广告）</span>');
 });
 it('keeps verified display order even when ad classification prevents a natural rank', () => {
  const row=unreliableAndroidCard();
  const html=renderEvidenceCard({...row,quality:{...row.quality,sequenceVerified:true},
   rank:{...row.rank,displayPosition:3,adDisplayPositions:[3]},
   topListings:[...row.topListings,{displayPosition:4,organicRank:1,resultType:'organic',name:'Unqualified organic observation',rating:4,reviewCount:20}]});
  expect(html).toContain('<th>含广告顺序</th>');
  expect(html).toContain('<span>首次显示顺序（含广告）</span><b>3</b>');
  expect(html).toContain('<span>本店广告位置</span><b>3</b>');
  expect(html).not.toContain('序号不是已验证的显示顺序或排名');
  expect(html).toContain('<td>4</td><td>—</td>');
  expect(html).not.toContain('<td>4</td><td>1</td>');
 });
 it.each(['matched','mismatch','unverified',undefined])('shows actual GPS %s and unverified Maps backend separately before the screenshots', deviceLocationStatus => {
  const row=unreliableAndroidCard();
  const html=renderEvidenceCard({...row,quality:{...row.quality,locationEvidence:{...row.quality.locationEvidence,deviceLocationStatus}}});
  const beforeScreenshots=html.slice(0,html.indexOf('<div class="shots'));
  expect(beforeScreenshots).toContain('设备 GPS：'+(deviceLocationStatus??'未记录'));
  expect(beforeScreenshots).toContain('Maps 搜索后端定位：unverified');
  expect(beforeScreenshots).toContain('设备定位匹配不代表搜索后端位置已经核实');
 });
 it('does not attach Android GPS wording to Web evidence', () => {
  const row=unreliableAndroidCard();
  const html=renderEvidenceCard({...row,surface:'web',locationMode:'map_view'});
  expect(html.slice(0,html.indexOf('<div class="shots'))).not.toContain('Maps 搜索后端定位：');
 });
});
