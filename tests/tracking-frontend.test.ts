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
  expect(m.present(o('a','2026-10-19',null)).label).toBe('未见');
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4))).toMatchObject({comparable:true,delta:5});
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4,{cohortKey:'changed'}))).toMatchObject({comparable:false,delta:null});
  expect(m.compare(o('a','2026-10-18',9),o('b','2026-10-19',4,{eligible:false})).delta).toBeNull();
 });
 it('breaks trends at missing dates, latest failures and changed cohorts', () => {
  const rows = [o('a','2026-10-16',9),o('b','2026-10-17',8),o('c','2026-10-19',7),o('d','2026-10-20',6,{cohortKey:'new'}),o('e','2026-10-21',5,{eligible:false})];
  expect(m.segments(rows).map(s=>s.map(x=>x.observationId))).toEqual([['a','b'],['c'],['d']]);
 });
 it('connects same-cohort qualified ranks across a short gap and breaks everywhere else', () => {
  const at = (id: string, iso: string, rank: number | null, extra: Record<string, unknown> = {}) => ({ ...o(id, iso.slice(0,10), rank, extra), observedAt: iso });
  const rows = [at('a','2026-10-20T02:00:00Z',9), at('b','2026-10-20T04:00:00Z',8), at('c','2026-10-21T20:00:00Z',7), at('d','2026-10-21T22:00:00Z',6,{cohortKey:'new'}), at('e','2026-10-22T00:00:00Z',null), at('f','2026-10-22T02:00:00Z',5,{cohortKey:'new'}), at('g','2026-10-22T04:00:00Z',4,{cohortKey:'new',eligible:false})];
  expect(m.series(rows).map(s => s.map(x => x.observationId))).toEqual([['a','b'],['c'],['d'],['f']]);
  expect(m.series(rows.slice().reverse()).map(s => s.map(x => x.observationId))).toEqual([['a','b'],['c'],['d'],['f']]);
 });
 it('summarises a range without averaging unqualified attempts', () => {
  const rows = [o('a','2026-10-18',2), o('b','2026-10-19',null), o('c','2026-10-20',7,{eligible:false}), o('d','2026-10-21',3), o('e','2026-10-21',12)];
  expect(m.stats(rows)).toEqual({ total:5, qualified:4, ranked:3, absent:1, unverified:1, best:2, worst:12, median:3, top3:2 });
  expect(m.stats([])).toMatchObject({ total:0, qualified:0, best:null, median:null });
 });
 it('parses report search volume and keeps unparseable text verbatim', () => {
  expect(m.volume('1,500,000 次/月 New York City · Google Search')).toEqual({ value:1500000, market:'New York City', text:'1,500,000 次/月 New York City · Google Search' });
  expect(m.volume('170 次/月 Mineola · Google Search')).toMatchObject({ value:170, market:'Mineola' });
  expect(m.volume('报告 100')).toEqual({ value:null, market:null, text:'报告 100' });
  expect(m.volume('')).toBeNull(); expect(m.volume(undefined)).toBeNull();
 });
 it('reports the newest attempt and a change only within the newest cohort', () => {
  const at = (id: string, iso: string, rank: number | null, extra: Record<string, unknown> = {}) => ({ ...o(id, iso.slice(0,10), rank, extra), observedAt: iso });
  const rows = [at('old','2026-10-18T10:00:00Z',3,{cohortKey:'legacy'}), at('a','2026-10-19T10:00:00Z',9), at('b','2026-10-20T10:00:00Z',null), at('c','2026-10-21T10:00:00Z',4)];
  expect(m.movement(rows)).toMatchObject({ latest:{observationId:'c'}, delta:5 });
  expect(m.movement([...rows, at('d','2026-10-21T12:00:00Z',4,{eligible:false,rank:{status:'failed',organicRank:null}})])).toMatchObject({ latest:{observationId:'d'}, delta:null });
  expect(m.movement([rows[1]!])).toMatchObject({ latest:{observationId:'a'}, delta:null });
  expect(m.movement([])).toEqual({ latest:null, delta:null });
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


describe('absence scope and geographic qualification in the served UI', () => {
 it('uses one absence label while preserving qualified versus incomplete evidence', () => {
  expect(m.present(o('absent','2026-10-27',null))).toMatchObject({label:'未见',short:'未见',qualified:true});
  for (const status of ['not_found','not_found_in_prefix']) {
   expect(m.present(o('partial','2026-10-27',null,{eligible:false,rank:{status,organicRank:null}}))).toMatchObject({label:'未见*',short:'未见*',qualified:false});
  }
  const ad = o('ad','2026-10-27',null,{rank:{status:'ad_only',organicRank:null}});
  expect(m.present(ad).label).toBe('未见');
  expect(m.notes(ad)).toContain('仅见本店广告');
  expect(m.present(null)).toMatchObject({label:'无记录',qualified:false});
  expect(m.notes(null)).toBe('');
 });
 it.each([undefined,null,{geographicRelevance:null},{geographicRelevance:{status:'unverified'}},
  {geographicRelevance:{status:'unexpected'}},
  {locationEvidence:{deviceLocationStatus:'matched',mapsLocationStatus:'matched'}}
 ])('does not infer geographic verification from eligibility or GPS: %j', quality => {
  const base=unreliableAndroidCard();
  const row={...base,surface:'web',eligible:true,metricOrganicRank:null,rank:{status:'not_found',organicRank:null},quality};
  const html=renderEvidenceCard(row);
  const visible=html.slice(0,html.indexOf('<details class="quality">'));
  expect(visible).toContain('地域未核实');
  expect(visible).toContain('本次采集范围内未见本店自然结果');
  expect(visible).not.toContain('确认未见');
  expect(row.eligible).toBe(true);
 });
 it.each([['outside','地域不符'],['mixed','地域混合'],['matched','']])('preserves geographic result %s independently of rank', (status,label) => {
  const row=o('geo','2026-10-27',3,{quality:{geographicRelevance:{status}}});
  expect(m.geography(row)).toBe(label);
  expect(m.present(row).short).toBe('3');
  if(status==='matched') expect(m.notes(row)).not.toContain('地域未核实');
 });
 it('shows uncertainty for ranked records too and distinguishes incomplete absence', () => {
  expect(m.notes(o('rank','2026-10-27',3))).toContain('地域未核实');
  expect(m.notes(o('partial','2026-10-27',null,{eligible:false,rank:{status:'not_found_in_prefix',organicRank:null}}))).toContain('证据不足');
 });
});


describe('overview absence annotations', () => {
 const script=UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
 const cell=script.split('\n').find(l=>l.startsWith('function overviewCell('))!;
 const render=(rows: unknown[])=>runInNewContext(cell+';overviewCell(rows,null,{id:"only-bear"},{id:"center",label:"中心"},null)', {
  rows,M:m,E:m.escape,href:()=> '#exact-evidence',params:()=>({}),when:(s:string)=>s,spark:()=>'',
 });
 it('renders geographic uncertainty next to the current absence, with scope in its tooltip', () => {
  const row=o('current','2026-10-27',null);
  const html=render([row]);
  expect(html).toContain('>未见</a>');
  expect(html).toContain('>地域未核实</small>');
  expect(html).toContain('本次采集范围内未见本店自然结果');
  expect(html).not.toContain('确认未见');
  expect(html).toContain('#exact-evidence');
 });
 it('uses the latest geographic status and does not resurrect a previous verified one', () => {
  const old=o('a','2026-10-26',3,{quality:{geographicRelevance:{status:'matched'}}});
  const latest=o('b','2026-10-27',null,{eligible:false,rank:{status:'not_found_in_prefix',organicRank:null}});
  const html=render([old,latest]);
  expect(html).toContain('>未见*</a>');
  expect(html).toContain('>采集证据不足</small>');
  expect(html).toContain('>地域未核实</small>');
  expect(html).not.toContain('ov-delta up');
 });
 it('does not annotate an uncollected cell as an absence or geographic finding', () => {
  const html=render([]);
  expect(html).toContain('无记录');
  expect(html).not.toContain('地域');
  expect(html).not.toContain('未见');
 });
});
