import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { UI_HTML } from '../src/web/ui.js';
import { KEYWORD_METRICS_SCRIPT } from '../src/web/keyword-metrics-view.js';
describe('keyword metric UI integration',()=>{
  it('renders three selectable trend metrics and a genuine zero with coverage and evidence links',()=>{
    const script=UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
    const setup=script.slice(0,script.indexOf('const E=M.escape'));
    const start=script.indexOf('function keywordMetricHtml('),end=script.indexOf('function renderKeywordMetrics(',start);
    expect(start).toBeGreaterThan(0);
    const row={pointId:'center',observationId:'id',observedAt:'2026-10-26T08:00:00Z',rank:{status:'not_found',organicRank:null},quality:{organicCoverage:15}};
    const rounds=[{id:'r',scanId:'scan',observedAt:row.observedAt,observedTo:row.observedAt,rows:[row],scopePoints:3,observed:1,solv:0,arp:null,atrp:null,solvPoints:1,arpPoints:0,atrpPoints:0,cohorts:{solv:'a',arp:null,atrp:null}}];
    const html=runInNewContext(setup+'\nconst E=M.escape;\n'+script.slice(start,end)+'\nkeywordMetricHtml(rounds,"solv",0,c)',{rounds,c:{r:{id:'s',surface:'web',keyword:'tea'},store:{fixedPoints:[{id:'center',label:'中心'}]}},when:(s:string)=>s,href:()=> '#evidence/s',params:()=>({}),badge:()=> '未见'});
    expect(html).toContain('固定点样本'); expect(html).toContain('SoLV');expect(html).toContain('ARP');expect(html).toContain('ATRP');
    expect(html).toContain('0%'); expect(html).toContain('1 / 3'); expect(html).toContain('无法计算');expect(html).toContain('#evidence/s');
    expect(html).toContain('data-keyword-metric="atrp"');expect(html).toContain('data-metric-round="0"');
  });
  it('uses the current keyword scanPoints, ignores other channels and withholds partial page loads',()=>{
    const script=UI_HTML.match(/<script>([\s\S]*)<\/script>/)![1]!;
    const setup=script.slice(0,script.indexOf('const E=M.escape'));
    const host={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
    const c={r:{id:'s',surface:'web',keyword:'tea',point:'a'},complete:true,store:{fixedPoints:[{id:'a'},{id:'b'}],keywordTargets:[{keyword:'tea',scanPoints:['a']}]}};
    const rows=[{surface:'web',storeId:'s',placeId:'p',keywordKey:'tea',pointId:'a',locationMode:'map_view',scanId:'batch',observedAt:'2026-10-26T08:00:00Z',cohortKey:'c',observationId:'one',source:{profileHash:'gps',adapterVersion:'v6'},evidence:{manifestKey:'tracking/web/2026-10-26/point/scan_parent/s/a/001/batch/att/manifest.json'},rank:{status:'ranked',organicRank:2},quality:{rankingReliable:true,sequenceVerified:true,classificationComplete:true,screenshotCoverageComplete:true,identityResolved:true,organicCoverage:15}}];
    const render=()=>runInNewContext(setup+'\nconst E=M.escape;\n'+KEYWORD_METRICS_SCRIPT+'\nrenderKeywordMetrics(c,rows)',{c,rows,document:{getElementById:()=>host},when:(s:string)=>s,href:()=> '#evidence',params:()=>({}),badge:()=> '2'});
    render();expect(host.innerHTML).toContain('100%');expect(host.innerHTML).toContain('1 / 1');
    c.complete=false;render();expect(host.innerHTML).toContain('历史尚未完整加载');expect(host.innerHTML).not.toContain('100%');
    c.complete=true;rows[0]!.surface='android';render();expect(host.innerHTML).toContain('0 个已记录轮次');
  });
});
