/** Shared, dependency-free history presentation logic, also embedded in the browser. */
export interface FrontendObservation {
  observationId: string; localDate: string; observedAt: string; keyword: string; keywordKey: string;
  eligible: boolean; metricOrganicRank: number | null; cohortKey: string | null;
  rank: { status: string; organicRank: number | null };
}
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
    if (row.eligible) return { label: row.rank.status === 'ad_only' ? '仅广告 · 确认自然未见' : '确认未见', short: '未见', kind: 'amber', qualified: true };
    const states: Record<string,string> = { failed:'采集失败',blocked:'采集受阻',ad_only:'仅见广告',not_found:'未确认未见',not_found_in_prefix:'已采部分未见',not_evaluated:'非排名列表',identity_unresolved:'商家匹配待核',unreliable:'排名证据不足' };
    if (row.rank.status === 'ranked' && Number.isInteger(row.rank.organicRank) && row.rank.organicRank! > 0) return { label:'观测 '+row.rank.organicRank, short:String(row.rank.organicRank)+'*', kind:'amber', qualified:false };
    const label = states[row.rank.status] || '排名不可用';
    return { label, short: label, kind: row.rank.status === 'failed' || row.rank.status === 'blocked' ? 'red' : 'gray', qualified:false };
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
  const evidenceUrl = (s: string): string | null => /^(?:tracking|android-maps|maps-keyword-capture|\d{4}-\d{2}-\d{2})\/[A-Za-z0-9_.+\-/%一-鿿]+\.png$/u.test(s) && !s.split('/').some(x=>x==='' || x==='.' || x==='..') ? '/api/evidence?key='+encodeURIComponent(s) : null;
  return { escape,key,daily,present,compare,days,segments,evidenceUrl };
}
