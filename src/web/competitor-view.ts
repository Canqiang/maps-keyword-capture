import type { competitorHistory } from './competitors.js';
import type { CompetitorMetric, CompetitorMetricRound } from './competitor-metrics.js';
type History = ReturnType<typeof competitorHistory>;
/** Shared browser/test renderer; points link to the exact original observation. */
export function createCompetitorPresentation() {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
  const colors = ['#6d3bd1','#087f8c','#cc6419','#28744c','#bc3971','#4768af'];
  function chart(data: History, selected: string[], link: (id: string) => string, when: (time: string) => string): string {
    const rows = data.rows;
    if (!rows.length) return '<div class="empty">所选关键词、点位和日期没有记录。</div>';
    const start = Date.parse(rows[0]!.observedAt), end = Date.parse(rows.at(-1)!.observedAt);
    const ranks = rows.flatMap(row => row.values.filter(v=>selected.includes(v.placeId)).map(v=>v.organicRank??1));
    const maxRank = Math.max(15, ...ranks), x = (t: string) => 60 + (Date.parse(t)-start)/Math.max(1,end-start)*780;
    const y = (rank: number) => 30+(rank-1)/Math.max(1,maxRank-1)*260;
    const ticks = [...new Set([1,3,5,10,15,maxRank])].filter(n=>n<=maxRank);
    let svg = '<svg style="display:block;width:100%;height:auto;min-width:640px" viewBox="0 0 900 350" role="img" aria-label="竞品自然排名变化；名次越小越靠前">'+ticks.map(n=>'<line x1="60" x2="840" y1="'+y(n)+'" y2="'+y(n)+'" stroke="#ece8f0"/><text x="42" y="'+(y(n)+4)+'" text-anchor="end" fill="#777">'+n+'</text>').join('');
    selected.forEach((id, index)=>{
      const color=colors[index%colors.length]!;
      let previous: {x:number;y:number;cohort:string;time:number} | null=null;
      for(const row of rows) {
        const value=row.values.find(v=>v.placeId===id), rank=value?.organicRank;
        if(!row.eligible || rank==null) {previous=null;continue;}
        const px=x(row.observedAt),py=y(rank),time=Date.parse(row.observedAt);
        if(previous && row.cohortKey && previous.cohort===row.cohortKey && time-previous.time<=3*3600000)
          svg+='<line x1="'+previous.x+'" y1="'+previous.y+'" x2="'+px+'" y2="'+py+'" stroke="'+color+'" stroke-width="2"/>';
        const name=data.businesses.find(b=>b.placeId===id)?.name||id;
        svg+='<a href="'+esc(link(row.observationId))+'"><circle cx="'+px+'" cy="'+py+'" r="4" fill="'+color+'"><title>'+esc(name+' · '+when(row.observedAt)+' · 自然第 '+rank+' 名'+(row.geography!=='matched'?' · 地域未核实':''))+'</title></circle></a>';
        previous=row.cohortKey?{x:px,y:py,cohort:row.cohortKey,time}:null;
      }
    });
    svg+='<text x="60" y="325" fill="#777">'+esc(when(rows[0]!.observedAt))+'</text><text x="840" y="325" text-anchor="end" fill="#777">'+esc(when(rows.at(-1)!.observedAt))+'</text></svg>';
    return svg;
  }
  function valueLabel(row: History['rows'][number], id: string): string {
    if(!row.eligible) return '待核';
    const v=row.values.find(v=>v.placeId===id);
    if(v?.organicRank!=null)return String(v.organicRank)+(v.adDisplayPositions.length?' · 广告 '+v.adDisplayPositions.join('/'):'');
    if(v?.adDisplayPositions.length)return (row.completeListingIndex||v.absenceConfirmed)?'仅见广告 '+v.adDisplayPositions.join('/'):'已见广告 '+v.adDisplayPositions.join('/')+' · 自然结果未知';
    return (v?.absenceConfirmed||row.completeListingIndex)?'采集范围内未见':'历史收录范围有限';
  }
  function metricChart(rounds: CompetitorMetricRound[], businesses: History['businesses'], selected: string[],
    metric: CompetitorMetric, type: 'line'|'bar', daily: boolean, when: (time:string)=>string): string {
    if(!rounds.length)return '<div class="empty">缺少可确认轮次的点位记录，暂时无法计算指标。可以切换“自然排名”查看已有记录。</div>';
    const start=Date.parse(rounds[0]!.observedAt),end=Date.parse(rounds.at(-1)!.observedAt);
    const x=(t:string)=>65+(Date.parse(t)-start)/Math.max(1,end-start)*780;
    const y=(n:number)=>metric==='solv'?300-n*2.7:30+(n-1)/20*270;
    const ticks=metric==='solv'?[0,20,40,60,80,100]:[1,5,10,15,21];
    let svg='<svg style="display:block;width:100%;height:auto;min-width:700px" viewBox="0 0 910 360" role="img" aria-label="多商家 '+metric.toUpperCase()+' 固定点样本趋势">';
    svg+=ticks.map(n=>'<line x1="65" x2="845" y1="'+y(n)+'" y2="'+y(n)+'" stroke="#dedee6" stroke-dasharray="2 3"/><text x="50" y="'+(y(n)+4)+'" text-anchor="end" fill="#777">'+n+(metric==='solv'?'%':'')+'</text>').join('');
    selected.forEach((id,index)=>{
      const color=colors[index%colors.length]!,name=businesses.find(b=>b.placeId===id)?.name||id;
      let previous:{x:number;y:number;time:number;cohort:string}|null=null;
      for(const round of rounds){
        const value=round.values.find(v=>v.placeId===id),n=value?.[metric],cohort=value?.cohorts[metric];
        if(n==null||!cohort){previous=null;continue;}
        const px=x(round.observedAt),py=y(n),time=Date.parse(round.observedAt);
        const title=esc(name+' · '+when(round.observedAt)+' · '+metric.toUpperCase()+' '+n.toFixed(1)+(metric==='solv'?'%':'')+' · 有效点 '+value!.points[metric]+'/'+round.scopePoints);
        if(type==='bar'){
          const width=Math.min(16,600/Math.max(1,rounds.length*selected.length));
          svg+='<rect x="'+(px+(index-(selected.length-1)/2)*(width+1)-width/2)+'" y="'+Math.min(py,300)+'" width="'+width+'" height="'+Math.max(2,300-py)+'" fill="'+color+'"><title>'+title+'</title></rect>';
        }else{
          if(previous&&previous.cohort===cohort&&time-previous.time<=(daily?27:3)*3600000)svg+='<line x1="'+previous.x+'" y1="'+previous.y+'" x2="'+px+'" y2="'+py+'" stroke="'+color+'" stroke-width="2.5"/>';
          svg+='<circle cx="'+px+'" cy="'+py+'" r="4.5" stroke="white" stroke-width="1.5" fill="'+color+'"><title>'+title+'</title></circle>';
        }
        previous={x:px,y:py,time,cohort};
      }
    });
    const labels=rounds.filter((_,i)=>i===0||i===rounds.length-1||i%Math.max(1,Math.ceil(rounds.length/6))===0);
    svg+=labels.map(r=>'<text x="'+x(r.observedAt)+'" y="335" text-anchor="middle" fill="#777" font-size="11">'+esc(when(r.observedAt))+'</text>').join('');
    return svg+'</svg>';
  }
  return {chart,metricChart,valueLabel,colors};
}

export const COMPETITOR_SCRIPT = String.raw`
async function competitorView(r,v){
  const loaded=await loadStore(r,v);if(!loaded)return;
  const {store,points}=loaded;context={store};navigation(r);
  document.getElementById('breadcrumb').textContent=store.name+' / 竞品排名';
  const choices=new URLSearchParams(location.hash.split('?')[1]||'');
  let metric=['rank','solv','arp','atrp'].includes(choices.get('metric'))?choices.get('metric'):'solv';
  let graph='line',range='all';
  const words=[...new Set([...M.activeKeywords(store),...store.keywords.core,...store.keywords.longTail,...(store.keywordTargets||[]).filter(t=>t.bestVariant).map(t=>M.bestVariant(t.keyword)).filter(Boolean)])];
  if(!r.keyword)r.keyword=words[0]||'';
  const pointOptions=new Map(points.map(p=>[p.pointId,p.label||p.pointId]));
  for(const p of store.fixedPoints||[])pointOptions.set(p.id,p.label||p.id);
  if(!pointOptions.has(r.point))pointOptions.set(r.point,r.point);
  const fixedIds=(store.fixedPoints||[]).map(p=>p.id);
  // Explicit configured scope; never silently infer an entire grid from whatever rows arrived.
  const allIds=fixedIds.length?fixedIds:[r.point];
  const allScope=choices.get('scope')==='all'||(!choices.has('scope')&&metric!=='rank');
  const pointIds=allScope?allIds:[r.point];
  app.innerHTML=storeHead(store,r,'对比本店与多家竞品：同一关键词、相同点位范围')+storeTabs(store,r)+
    '<div class="toolbar"><div class="toolbar-left"><label>关键词 <select id="competitor-keyword">'+[...new Set([r.keyword,...words])].map(w=>'<option value="'+E(w)+'" '+(w===r.keyword?'selected':'')+'>'+E(w)+'</option>').join('')+'</select></label><label>采样范围 <select id="competitor-point"><option value="__all" '+(allScope?'selected':'')+'>全部固定点（'+allIds.length+'）</option>'+[...pointOptions].map(([id,label])=>'<option value="'+E(id)+'" '+(!allScope&&id===r.point?'selected':'')+'>'+E(label)+'</option>').join('')+'</select></label><label>从 <input type="date" id="competitor-from" value="'+E(r.from)+'"></label><label>至 <input type="date" id="competitor-to" value="'+E(r.to)+'"></label><button class="button" id="competitor-apply">查看趋势</button></div></div><div class="notice">固定点样本，不代表完整区域覆盖。自然排名与广告分开；未见仅指采集范围。历史收录不完整时不推断竞品掉榜，ATRP 证据不足显示无法计算。</div><section class="section" id="competitor-data"><div class="loading">正在按关键词加载竞品数据…</div></section>';
  bindSurface(r);
  document.getElementById('competitor-apply').onclick=()=>{const point=document.getElementById('competitor-point').value;go(r,{keyword:document.getElementById('competitor-keyword').value,point:point==='__all'?r.point:point,scope:point==='__all'?'all':'one',metric,from:document.getElementById('competitor-from').value,to:document.getElementById('competitor-to').value});};
  if(!r.keyword){document.getElementById('competitor-data').innerHTML='<div class="empty">没有可查询的关键词。</div>';return;}
  const data={businesses:[],rows:[]},pages=new Map(pointIds.map(id=>[id,{cursor:null,complete:false}]));let complete=false,selected=null;
  const selectionKey='maps-competitors-v1:'+JSON.stringify([r.id,r.surface,pointIds.slice().sort(),M.key(r.keyword)]);
  try{const saved=JSON.parse(localStorage.getItem(selectionKey)||'null');if(Array.isArray(saved)&&saved.length<=6&&saved.every(id=>typeof id==='string'&&/^ChIJ[\w-]+$/.test(id)))selected=saved;}catch{}
  const link=id=>href('evidence',r.id,params(r,{observation:id}));
  const metricText={solv:'SoLV：进入自然前 3 的有效点占比，越高越好。',arp:'ARP：自然前 20 中已见排名的平均值，越低越好；未见点不计入，需同时看有效点数。',atrp:'ATRP：全部选定点的平均排名，越低越好；只有确认自然前 20 未见或列表到底，才能按 21 计入。',rank:'自然排名：按单个点位逐次比较，名次越小越好。广告另列。'};
  function render(){
    let own=data.businesses.find(b=>b.placeId===store.placeId);
    if(own)own.name=store.name;else{own={placeId:store.placeId,name:store.name,appearances:0};data.businesses.unshift(own);}
    const ordered=[own,...data.businesses.filter(b=>b.placeId!==store.placeId).sort((a,b)=>b.appearances-a.appearances||a.placeId.localeCompare(b.placeId))];
    if(!selected){selected=ordered.slice(0,4).map(b=>b.placeId);try{localStorage.setItem(selectionKey,JSON.stringify(selected));}catch{}}
    for(const id of selected)if(!data.businesses.some(b=>b.placeId===id)){const placeholder={placeId:id,name:id,appearances:0};data.businesses.push(placeholder);ordered.push(placeholder);}
    const shown=selected.map(id=>data.businesses.find(b=>b.placeId===id)).filter(Boolean);
    let rounds=CM.rounds(data.rows,pointIds,selected,complete);
    if(range==='daily'){const last=new Map();for(const round of rounds)last.set(round.localDate,round);rounds=[...last.values()];}
    const rankPoint=pointIds.includes(r.point)?r.point:pointIds[0];
    const rankData={...data,rows:data.rows.filter(row=>row.pointId===rankPoint)};
    const chart=metric==='rank'?C.chart(rankData,selected,link,when):C.metricChart(rounds,data.businesses,selected,metric,graph,range==='daily',when);
    const options=(key,items,chosen)=>'<div class="row"><span class="muted">'+({metric:'指标',range:'数据范围',graph:'图形'}[key])+'</span>'+items.map(([value,label])=>'<button class="button '+(chosen===value?'primary':'')+'" data-'+key+'="'+value+'" aria-pressed="'+(chosen===value)+'">'+label+'</button>').join('')+'</div>';
    const controls='<div class="row between" style="padding:0 24px 18px">'+options('metric',[['solv','SoLV'],['arp','ARP'],['atrp','ATRP'],['rank','自然排名']],metric)+(metric==='rank'?'':options('range',[['all','每轮采集'],['daily','每日末轮']],range)+options('graph',[['line','折线'],['bar','柱状']],graph))+'</div>';
    const headers=shown.map(b=>'<th>'+E(b.name)+'</th>').join('');
    const table=metric==='rank'?'<table><thead><tr><th>采集时间 · '+E(rankPoint)+'</th>'+headers+'<th>收录 / 采集条数</th><th>地域</th></tr></thead><tbody>'+rankData.rows.slice().reverse().map(row=>'<tr><td><a href="'+E(link(row.observationId))+'">'+E(when(row.observedAt))+'</a></td>'+shown.map(b=>'<td>'+E(C.valueLabel(row,b.placeId))+'</td>').join('')+'<td>'+row.indexedListings+' / '+row.listingsObserved+'</td><td>'+E(row.geography==='matched'?'已匹配':'地域未核实 / 不符')+'</td></tr>').join('')+'</tbody></table>':
      '<table><thead><tr><th>轮次开始 · 有效点 / 范围点</th>'+headers+'<th>点位原始记录</th></tr></thead><tbody>'+rounds.slice().reverse().map(round=>'<tr><td>'+E(when(round.observedAt))+(round.reason?'<br><small>'+E(round.reason)+'</small>':'')+'</td>'+shown.map(b=>{const value=round.values.find(x=>x.placeId===b.placeId),n=value?.[metric];return '<td>'+(n==null?'无法计算':n.toFixed(1)+(metric==='solv'?'%':''))+'<br><small class="muted">'+(value?.points[metric]||0)+' / '+round.scopePoints+' 点</small></td>';}).join('')+'<td>'+round.rows.map(row=>'<a href="'+E(link(row.observationId))+'">'+E(row.pointId)+'</a>').join(' · ')+'<br><small>'+E(round.rows.every(row=>row.geography==='matched')?'地域已匹配':'地域未核实 / 不符')+'</small></td></tr>').join('')+'</tbody></table>';
    document.getElementById('competitor-data').innerHTML='<div class="section-heading"><div><h2>竞品变化趋势</h2><p>'+data.rows.length+' 次观测 · '+pointIds.length+' 个固定点样本 · 最多比较 6 家</p></div></div>'+controls+'<div id="competitor-chart" style="padding:12px 24px;overflow-x:auto">'+chart+'</div><div class="row" style="padding:0 24px 18px;justify-content:center">'+shown.map((b,i)=>'<span style="color:'+C.colors[i%C.colors.length]+'">● '+E(b.name)+'</span>').join('')+'</div><p class="small muted" style="padding:0 24px">'+E(metricText[metric])+' '+(metric==='rank'?'当前只显示 '+E(rankPoint)+'，可在上方更换点位。':range==='daily'?'每日末轮按各店日期取最后一轮，不做平滑、不取最好成绩。':'按清单确认同一轮次后汇总，不按时间接近拼接点位。')+' 采集条件或有效点组成变化时断线。</p><details style="padding:12px 24px"><summary>选择对比商家（'+shown.length+' 家）</summary><div class="row spaced"><label>查找商家 <input id="competitor-search" placeholder="按店名筛选"></label></div><div class="row spaced" style="max-height:180px;overflow:auto">'+ordered.map(b=>'<label class="meta-chip" data-business="'+E(b.name.toLowerCase())+'"><input type="checkbox" data-competitor="'+E(b.placeId)+'" '+(selected.includes(b.placeId)?'checked':'')+'> '+E(b.name)+(b.placeId===store.placeId?'（本店）':'')+'</label>').join('')+'</div></details><div class="table-wrap">'+table+'</div>'+(!complete?'<div class="section-footer"><button class="button" id="competitor-more">继续加载后续记录</button><span>日期范围尚未加载完整，汇总指标暂不计算。</span></div>':'');
    for(const button of document.querySelectorAll('[data-metric]'))button.onclick=()=>{metric=button.dataset.metric;render();};
    for(const button of document.querySelectorAll('[data-range]'))button.onclick=()=>{range=button.dataset.range;render();};
    for(const button of document.querySelectorAll('[data-graph]'))button.onclick=()=>{graph=button.dataset.graph;render();};
    document.getElementById('competitor-search').oninput=e=>{for(const el of document.querySelectorAll('[data-business]'))el.hidden=!el.dataset.business.includes(e.target.value.toLowerCase());};
    for(const box of document.querySelectorAll('[data-competitor]'))box.onchange=()=>{const ids=[...document.querySelectorAll('[data-competitor]:checked')].map(b=>b.dataset.competitor);if(ids.length>6){box.checked=false;return;}selected=ids;try{localStorage.setItem(selectionKey,JSON.stringify(selected));}catch{}render();};
    const more=document.getElementById('competitor-more');if(more)more.onclick=()=>{more.disabled=true;load().catch(()=>{if(v===revision){more.disabled=false;more.textContent='加载失败，点击重试';}});};
  }
  async function load(){
    // Three requests at a time; each page remains bounded, even for larger configured scopes.
    const pending=[...pages].filter(([,state])=>!state.complete);
    for(let i=0;i<pending.length;i+=3){
      const results=await Promise.all(pending.slice(i,i+3).map(async([id,state])=>{
        const q=new URLSearchParams({surface:r.surface,point:id,keyword:r.keyword,from:r.from,to:r.to,limit:'500'});if(state.cursor)q.set('cursor',state.cursor);
        return {id,page:await api('/stores/'+encodeURIComponent(r.id)+'/competitors?'+q)};
      }));if(v!==revision)return;
      for(const {id,page} of results){const state=pages.get(id);if(page.nextCursor&&page.nextCursor===state.cursor)throw Error('分页未推进，请刷新');
        data.rows.push(...page.rows);for(const b of page.businesses){const old=data.businesses.find(x=>x.placeId===b.placeId);if(old){old.name=b.name;old.appearances+=b.appearances;}else data.businesses.push(b);}
        state.cursor=page.nextCursor;state.complete=page.complete;
      }
    }
    data.rows.sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.observationId.localeCompare(b.observationId));
    complete=[...pages.values()].every(state=>state.complete);render();
  }
  await load();
}
`;
