/** Runs in the existing authenticated UI; consumes only already-loaded history. */
export const KEYWORD_METRICS_SCRIPT = String.raw`
function keywordMetricHtml(rounds,metric,index,c){
const definitions={solv:{label:'SoLV',unit:'%',help:'Top 3 点数 / 可判断 Top 3 的点数，越高越好'},arp:{label:'ARP',unit:'',help:'已进入前 20 的点的平均自然排名，越低越好'},atrp:{label:'ATRP',unit:'',help:'全部范围点的平均排名；确认前 20 未见计 21，越低越好'}};
const format=(v,k)=>v===null?'—':k==='solv'?(v*100).toFixed(v*100%1?1:0)+'%':Number(v.toFixed(2)).toString();
const latest=rounds.at(-1),selected=rounds[index]||latest,def=definitions[metric];
const profileChange=new Set(rounds.flatMap(o=>o.rows.map(r=>JSON.stringify([r.source?.profileHash,r.source?.adapterVersion,r.locationMode])))).size>1;
const cards=Object.entries(definitions).map(([k,d])=>'<button type="button" class="keyword-metric-card'+(k===metric?' active':'')+'" data-keyword-metric="'+k+'" aria-pressed="'+(k===metric)+'"><span>'+d.label+'</span><strong>'+format(latest?.[k]??null,k)+'</strong><small>'+(latest?latest[k+'Points']+' / '+latest.scopePoints+' 点':'无记录')+(k==='arp'?' · 上榜点':k==='atrp'?' · 可评估点':' · 合格点')+'</small></button>').join('');
let chart='<div class="trend-empty">没有可绘制的 '+def.label+'。'+(metric==='atrp'?'需全部范围点都有自然排名，或已确认前 20 未见 / 列表结束；前 15 条未见不足以计算。':'请查看点位证据与历史加载状态。')+'</div>';
if(rounds.some(o=>o[metric]!==null)){
 const width=700,height=210,left=45,right=20,top=20,bottom=165;
 const min=Date.parse(rounds[0].observedAt),max=Date.parse(rounds.at(-1).observedAt),x=o=>max===min?(left+width-right)/2:left+(Date.parse(o.observedAt)-min)/(max-min)*(width-left-right);
 const y=v=>metric==='solv'?bottom-v*(bottom-top):top+(v-1)/20*(bottom-top);
 const ticks=(metric==='solv'?[0,.25,.5,.75,1]:[1,5,10,15,21]).map(v=>'<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#e9e5f1"/><text class="chart-label" text-anchor="end" x="'+(left-8)+'" y="'+(y(v)+4)+'">'+format(v,metric)+'</text>').join('');
 const paths=K.segments(rounds,metric).map(segment=>'<path class="chart-line" d="'+segment.map((o,i)=>(i?'L':'M')+x(o).toFixed(1)+' '+y(o[metric]).toFixed(1)).join(' ')+'"/>').join('');
 const dots=rounds.map((o,i)=>o[metric]===null?'':'<a href="#" data-metric-round="'+i+'" aria-label="'+E(when(o.observedAt)+' '+def.label+' '+format(o[metric],metric))+'"><title>'+E(when(o.observedAt)+' · '+format(o[metric],metric)+' · '+o[metric+'Points']+'/'+o.scopePoints+' 点')+'</title><circle class="chart-dot" cx="'+x(o)+'" cy="'+y(o[metric])+'" r="'+(i===index?6:4)+'"/></a>').join('');
 const labels=[rounds[0],...(rounds.length>1?[rounds.at(-1)]:[])].map((o,i)=>'<text class="chart-label" x="'+x(o)+'" y="197" text-anchor="'+(max===min?'middle':i?'end':'start')+'">'+E(when(o.observedAt))+'</text>').join('');
 chart='<div class="chart-wrap"><svg class="trend-chart metric-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+def.label+' 固定点样本趋势">'+ticks+paths+dots+labels+'</svg></div>';
}
const choice=rounds.length?'<label class="date-label">查看轮次 <select id="keyword-metric-round" aria-label="指标采集轮次">'+rounds.map((o,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+E(when(o.observedAt))+' · '+o.observed+'/'+o.scopePoints+' 点</option>').reverse().join('')+'</select></label>':'';
const detail=selected?'<div class="metric-round"><p><b>'+E(when(selected.observedAt))+'</b> — '+E(when(selected.observedTo))+' · 本轮已有 '+selected.observed+' / '+selected.scopePoints+' 个范围点</p><p class="small">'+Object.keys(definitions).map(k=>definitions[k].label+'：'+(selected[k]===null?'无法计算':format(selected[k],k))+'（'+selected[k+'Points']+'/'+selected.scopePoints+' 点）').join(' · ')+'</p>'+(selected.reason?'<p class="small muted">'+E(selected.reason)+'</p>':'')+'<div class="date-observations">'+selected.rows.map(o=>'<a href="'+E(href('evidence',c.r.id,params(c.r,{point:o.pointId,observation:o.observationId,keyword:c.r.keyword})))+'">'+E((c.store.fixedPoints||[]).find(p=>p.id===o.pointId)?.label||o.pointId)+' · '+E(when(o.observedAt))+'<br>'+badge(o)+'<small class="block">已核验自然结果 '+E(o.quality?.organicCoverage??'未知')+' 条 · 查看原图 ↗</small></a>').join('')+'</div></div>':'';
return '<section class="keyword-metrics"><div class="section-heading"><div><h3>关键词指标趋势 <span class="meta-chip">固定点样本</span></h3><p>'+E(c.r.keyword)+' · 每轮汇总固定点，不代表完整区域覆盖率。卡片为最新轮次，点击切换指标。</p></div></div><div class="keyword-metric-cards">'+cards+'</div><p class="small muted">'+def.help+' · 不计广告排名</p>'+chart+(profileChange?'<p class="notice">此区间包含多种采集条件；跨条件的变化不能当作 SEO 提升。</p>':'')+'<p class="small muted">'+rounds.length+' 个已记录轮次 · 定位 / 版本 / 参与点变化、不可用数据或间隔超过 3 小时处断线；不补值。日期使用页面时区。</p>'+choice+detail+'<details class="spaced"><summary>统计口径与数据不足的含义</summary><p class="small muted">范围采用本页该词的固定点配置，不追认历史计划；未加载、未采、失败、非榜单及匹配待核不当作未上榜。SoLV 的分母是能判断是否进入 Top 3 的点；ARP 只平均已上榜点，可能偏向强势位置。ATRP 必须全部范围点都有排名或合格的前 20 未见证据，21 只是计算罚值。各指标分母不同，请同时看点数。定位回执不证明 Google 后端地域。全无记录的轮次无法凭空恢复。</p></details></section>';
}
function renderKeywordMetrics(c,rows){
 const host=document.getElementById('keyword-metrics');if(!host||!c.store)return;
 const target=(c.store.keywordTargets||[]).find(t=>M.key(t.keyword)===M.key(c.r.keyword)||(t.bestVariant&&M.key(M.bestVariant(t.keyword)||'')===M.key(c.r.keyword)));
 const pointIds=(c.store.fixedPoints||[]).filter(p=>!target?.scanPoints||target.scanPoints.includes(p.id)).map(p=>p.id);
 if(!pointIds.length){host.innerHTML='<p class="small muted">这个词尚无固定点范围；网格指标请在周围采集点查看。</p>';return;}
 const extra=(c.trendExtra||{})[M.key(c.r.keyword)]||[];
 const complete=c.complete===true&&pointIds.every(id=>id===c.r.point||extra.some(s=>s.id===id&&s.complete!==false));
 const selectedRows=rows.filter(o=>o.surface===c.r.surface&&o.storeId===c.r.id&&M.key(o.keywordKey)===M.key(c.r.keyword));
 const rounds=K.rounds(selectedRows,pointIds,complete);
 const metric=['solv','arp','atrp'].includes(c.keywordMetric)?c.keywordMetric:'solv';
 const remembered=rounds.findIndex(o=>o.id===c.keywordMetricRound);
 const index=remembered<0?rounds.length-1:remembered;
 host.innerHTML=(!complete?'<div class="notice">固定点历史尚未完整加载，指标暂不可用。</div>':'')+keywordMetricHtml(rounds,metric,index,c);
 for(const b of host.querySelectorAll('[data-keyword-metric]'))b.onclick=()=>{c.keywordMetric=b.dataset.keywordMetric;renderKeywordMetrics(c,rows);};
 const select=i=>{c.keywordMetricRound=rounds[i]?.id;renderKeywordMetrics(c,rows);};
 for(const b of host.querySelectorAll('[data-metric-round]'))b.onclick=e=>{e.preventDefault();select(Number(b.dataset.metricRound));};
 const picker=host.querySelector('#keyword-metric-round');if(picker)picker.onchange=e=>select(Number(e.target.value));
}
`;

export const KEYWORD_METRICS_STYLE = String.raw`
.keyword-metrics{margin:0 0 28px;padding:18px 0 24px;border-bottom:1px solid #e5def0}
.keyword-metric-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.keyword-metric-card{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:13px 16px;border:1px solid #e1d9ec;border-radius:10px;background:white;cursor:pointer;text-align:left}
.keyword-metric-card strong{font-size:25px}.keyword-metric-card small{font-size:12px;color:#6c647a}.keyword-metric-card.active{border-color:#7540db;background:#f5f0ff}.keyword-metric-card.active strong{color:#6937ce}
.metric-round{margin-top:16px;padding:12px;background:#faf8fe;border:1px solid #ede7f5;border-radius:8px}.metric-round p{margin:0 0 9px}.metric-chart{min-width:460px}.keyword-metrics .meta-chip{vertical-align:middle;font-size:11px}.keyword-metrics .date-label select{max-width:100%}
@media(max-width:600px){.keyword-metric-card{padding:9px}.keyword-metric-card strong{font-size:21px}.keyword-metrics{padding-top:10px}.keyword-metric-cards{gap:6px}}
`;
