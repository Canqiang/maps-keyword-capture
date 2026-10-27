/** Shared, dependency-free history presentation logic, also embedded in the browser. */
export interface FrontendObservation {
  observationId: string; localDate: string; observedAt: string; keyword: string; keywordKey: string;
  eligible: boolean; metricOrganicRank: number | null; cohortKey: string | null;
  rank: { status: string; organicRank: number | null };
  quality?: { geographicRelevance?: { status?: string } | null } | null;
}
interface TargetStore {
  keywords: { core: string[]; longTail: string[] };
  keywordTargets?: Array<{ keyword: string; sourceSearchVolumeText?: string; pointTargets: Array<{ pointId: string; targetRank: number; targetText: string; historicalBaselineDisplay?: string }> }>;
}
interface PlannedPoint { id: string; label: string; latitude: number; longitude: number; distanceKm: number }
interface PointChoice { pointId: string; label?: string; planned?: boolean; point: { latitude: number | null; longitude: number | null; distanceKm: number | null }; observations?: number }
export function createFrontendModel() {
  const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const key = (s: string): string => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const daily = (rows: FrontendObservation[]): Record<string, FrontendObservation[]> => {
    const result: Record<string, FrontendObservation[]> = Object.create(null);
    for (const row of rows) (result[row.localDate] ??= []).push(row);
    for (const group of Object.values(result)) group.sort((a,b) => b.observedAt.localeCompare(a.observedAt) || b.observationId.localeCompare(a.observationId));
    return result;
  };
  const present = (row?: FrontendObservation | null) => {
    if (!row) return { label: '无记录', short: '—', kind: 'gray', qualified: false };
    if (row.eligible && row.metricOrganicRank !== null) return { label: '自然排名 ' + row.metricOrganicRank, short: String(row.metricOrganicRank), kind: row.metricOrganicRank <= 3 ? 'green' : 'purple', qualified: true };
    if (row.eligible) return { label: '未见', short: '未见', kind: 'amber', qualified: true };
    const states: Record<string,string> = { failed:'采集失败',blocked:'采集受阻',ad_only:'仅见广告',not_found:'未见*',not_found_in_prefix:'未见*',not_evaluated:'非排名列表',identity_unresolved:'商家匹配待核',unreliable:'排名证据不足' };
    if (row.rank.status === 'ranked' && Number.isInteger(row.rank.organicRank) && row.rank.organicRank! > 0) return { label:'观测 '+row.rank.organicRank, short:String(row.rank.organicRank)+'*', kind:'amber', qualified:false };
    const shorts: Record<string,string> = { failed:'失败',blocked:'受阻',ad_only:'仅广告',not_found:'未见*',not_found_in_prefix:'未见*',not_evaluated:'非列表',identity_unresolved:'待核',unreliable:'待核' };
    const label = states[row.rank.status] || '排名不可用';
    return { label, short: shorts[row.rank.status] || '不可用', kind: row.rank.status === 'failed' || row.rank.status === 'blocked' ? 'red' : 'gray', qualified:false };
  };
  /** Geographic qualification is independent of collection eligibility and GPS receipts. */
  const geography = (row?: FrontendObservation | null): string => {
    if (!row) return '';
    const status = row.quality?.geographicRelevance?.status;
    return status === 'matched' ? '' : status === 'outside' ? '地域不符' : status === 'mixed' ? '地域混合' : '地域未核实';
  };
  const scopeNote = (row?: FrontendObservation | null): string => {
    if (!row) return '';
    if (row.eligible && row.metricOrganicRank === null) return '本次采集范围内未见本店自然结果；不代表整个区域未上榜，也不是第 16 或 21 名。';
    if (row.rank.status === 'not_found' || row.rank.status === 'not_found_in_prefix') return '已采部分未见本店自然结果，但采集证据不足，不能判断完整采集范围。';
    return '';
  };
  const adNote = (row?: FrontendObservation | null): string => row?.rank.status === 'ad_only' ? '仅见本店广告，广告不计自然排名。' : '';
  const hint = (row?: FrontendObservation | null): string => [present(row).label, scopeNote(row), adNote(row), geography(row)].filter(Boolean).join(' · ');
  /** Visible annotations: compact table cells retain geography and evidence warnings. */
  const notes = (row?: FrontendObservation | null, compact = false): string => {
    if (!row) return '';
    const geo = geography(row), scope = scopeNote(row), ad = adNote(row);
    const incomplete = !row.eligible && (row.rank.status === 'not_found' || row.rank.status === 'not_found_in_prefix');
    return (scope && !compact ? '<small class="observation-annotation">' + escape(scope) + '</small>' : '')
      + (incomplete && compact ? '<small class="observation-annotation">采集证据不足</small>' : '')
      + (ad ? '<small class="observation-annotation">' + escape(compact ? '仅见本店广告' : ad) + '</small>' : '')
      + (geo ? '<small class="observation-annotation geography-warning" title="地域按结果证据单独判断；坐标或 GPS 回执不代表 Google 搜索后端地域已核实。">' + escape(geo) + '</small>' : '');
  };
  const compare = (before?: FrontendObservation, after?: FrontendObservation) => {
    if (!before || !after) return { comparable:false,delta:null,reason:'请选择两个确切的采集记录' };
    if (!before.eligible || !after.eligible || before.metricOrganicRank === null || after.metricOrganicRank === null) return { comparable:false,delta:null,reason:'端点缺少合格自然排名；只比较截图' };
    if (!before.cohortKey || before.cohortKey !== after.cohortKey) return { comparable:false,delta:null,reason:'定位、渠道或采集条件不一致；不计算升降' };
    return { comparable:true,delta:before.metricOrganicRank-after.metricOrganicRank,reason:'同一采集条件下的合格自然排名' };
  };
  const days = (from: string, to: string): string[] => {
    const result: string[] = [], start = Date.parse(from+'T00:00:00Z'), end = Date.parse(to+'T00:00:00Z');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return result;
    for(let t=start; t<=end && result.length<90;t+=86400000) result.push(new Date(t).toISOString().slice(0,10));
    return result;
  };
  const segments = (rows: FrontendObservation[]): FrontendObservation[][] => {
    const groups = daily(rows), latest = Object.keys(groups).sort().map(day=>groups[day]![0]!);
    const result: FrontendObservation[][] = []; let previous: FrontendObservation | null = null;
    for (const row of latest) {
      if (!row.eligible || row.metricOrganicRank === null || !row.cohortKey) { previous=null; continue; }
      const contiguous = previous && Date.parse(row.localDate+'T00:00:00Z')-Date.parse(previous.localDate+'T00:00:00Z')===86400000 && previous.cohortKey===row.cohortKey;
      if (contiguous) result[result.length-1]!.push(row); else result.push([row]);
      previous=row;
    }
    return result;
  };
  /** Connect consecutive qualified ranks of one series when the cohort is unchanged and the gap is short; anything else breaks the line. */
  const series = (rows: FrontendObservation[], maxGapHours = 36): FrontendObservation[][] => {
    const sorted = [...rows].sort((a,b) => a.observedAt.localeCompare(b.observedAt) || a.observationId.localeCompare(b.observationId));
    const result: FrontendObservation[][] = []; let previous: FrontendObservation | null = null;
    for (const row of sorted) {
      if (!row.eligible || row.metricOrganicRank === null || !row.cohortKey) { previous = null; continue; }
      const contiguous = previous && previous.cohortKey === row.cohortKey && Date.parse(row.observedAt) - Date.parse(previous.observedAt) <= maxGapHours * 3600000;
      if (contiguous) result[result.length-1]!.push(row); else result.push([row]);
      previous = row;
    }
    return result;
  };
  /** Range statistics over every attempt; unqualified attempts are counted, never averaged. */
  const stats = (rows: FrontendObservation[]) => {
    const ranks = rows.filter(o => o.eligible && o.metricOrganicRank !== null).map(o => o.metricOrganicRank!).sort((a,b) => a-b);
    const absent = rows.filter(o => o.eligible && o.metricOrganicRank === null).length;
    const median = ranks.length ? (ranks.length % 2 ? ranks[(ranks.length-1)/2]! : (ranks[ranks.length/2-1]! + ranks[ranks.length/2]!) / 2) : null;
    return { total: rows.length, qualified: ranks.length + absent, ranked: ranks.length, absent, unverified: rows.length - ranks.length - absent,
      best: ranks[0] ?? null, worst: ranks.at(-1) ?? null, median, top3: ranks.filter(n => n <= 3).length };
  };
  /** Report search volume such as "1,500,000 次/月 New York City · Google Search"; unparseable text is kept verbatim. */
  const volume = (text?: string | null): { value: number | null; market: string | null; text: string } | null => {
    if (!text || !text.trim()) return null;
    const match = /^\s*([\d,]+)\s*次\/月\s*(.*?)\s*(?:·.*)?$/u.exec(text);
    if (!match) return { value: null, market: null, text: text.trim() };
    return { value: Number(match[1]!.replace(/,/g, '')), market: match[2] || null, text: text.trim() };
  };
  /** Newest attempt of one keyword at one point, and the change since the earliest qualified rank of the same cohort. */
  const movement = (rows: FrontendObservation[]): { latest: FrontendObservation | null; delta: number | null } => {
    const sorted = [...rows].sort((a,b) => a.observedAt.localeCompare(b.observedAt) || a.observationId.localeCompare(b.observationId));
    const latest = sorted.at(-1) ?? null;
    if (!latest || !latest.eligible || latest.metricOrganicRank === null || !latest.cohortKey) return { latest, delta: null };
    const base = sorted.find(o => o.eligible && o.metricOrganicRank !== null && o.cohortKey === latest.cohortKey)!;
    return { latest, delta: base === latest ? null : base.metricOrganicRank! - latest.metricOrganicRank };
  };
  /** Same rule as the scan planner's bestVariantOf. */
  const bestVariant = (keyword: string): string | null => { const t = keyword.trim().replace(/\s+/gu, ' '); return /^best\b/iu.test(t) ? null : 'best ' + t; };
  const evidenceUrl = (s: string): string | null => /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+\.png$/u.test(s) && !s.split('/').some(x=>x==='' || x==='.' || x==='..') ? '/api/evidence?key='+encodeURIComponent(s) : null;
  const activeKeywords = (store: TargetStore): string[] => store.keywordTargets ? store.keywordTargets.map(t => t.keyword) : [...store.keywords.core, ...store.keywords.longTail];
  const targetFor = (store: TargetStore, keyword: string, pointId: string) => store.keywordTargets?.find(t => key(t.keyword) === key(keyword))?.pointTargets.find(t => t.pointId === pointId) ?? null;
  const pointChoices = (observed: PointChoice[], planned: PlannedPoint[] = []): PointChoice[] => {
    const choices = planned.map(p => {
      const actual = observed.find(o => o.pointId === p.id);
      return actual ? { ...actual, label: p.label, planned: true } : { pointId: p.id, label: p.label, planned: true, observations: 0, point: { latitude: p.latitude, longitude: p.longitude, distanceKm: p.distanceKm } };
    });
    return [...choices, ...observed.filter(o => !planned.some(p => p.id === o.pointId))];
  };
  return { escape,key,daily,present,geography,notes,hint,compare,days,segments,series,stats,volume,movement,bestVariant,evidenceUrl,activeKeywords,targetFor,pointChoices };
}
