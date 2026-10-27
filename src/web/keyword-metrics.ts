import type { HistoryObservation } from '../domain/history.js';

export type KeywordMetric = 'solv' | 'arp' | 'atrp';
export interface KeywordMetricRound {
  id: string; scanId: string; observedAt: string; observedTo: string;
  rows: HistoryObservation[]; scopePoints: number; observed: number;
  solv: number | null; arp: number | null; atrp: number | null;
  solvPoints: number; arpPoints: number; atrpPoints: number;
  cohorts: Record<KeywordMetric, string | null>; reason: string | null;
}

/** Dependency-free, shared by tests and the served browser. Never modifies raw observations. */
export function createKeywordMetricsModel() {
  const mean = (values: number[]) => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
  // Observation.scanId is a batch run ID in Web ingestion. The writer's manifest
  // namespace is the existing authoritative parent scan receipt; time proximity is not.
  const parentScan = (row: HistoryObservation): string | null => {
    const key=row.evidence.manifestKey??'';
    const match=/^tracking\/(web|android)\/\d{4}-\d{2}-\d{2}\/point\/(scan_[A-Za-z0-9_-]+)\//u.exec(key);
    return match && match[1]===row.surface && key.endsWith('/manifest.json') && key.includes('/'+row.scanId+'/')
      && !key.split('/').some(x=>x==='..'||x==='.') ? match[2]! : null;
  };
  const qualified = (row: HistoryObservation): boolean => {
    const q=row.quality;
    return row.locationMode!=='query_only' && !!row.cohortKey && !!q && q.rankingReliable===true && q.sequenceVerified===true
      && q.classificationComplete===true && q.screenshotCoverageComplete===true && q.identityResolved===true
      && !['outside','mixed'].includes(q.geographicRelevance?.status??'');
  };
  const rounds = (rows: HistoryObservation[], pointIds: string[], complete = true): KeywordMetricRound[] => {
    const scope = [...new Set(pointIds)].sort(), groups = new Map<string, HistoryObservation[]>();
    for (const row of rows) {
      if (!scope.includes(row.pointId) || !row.scanId || row.gridRunId || row.gridSpec || !Number.isFinite(Date.parse(row.observedAt))) continue;
      const parent=parentScan(row);
      if(row.locationMode==='query_only'&&!parent)continue;
      const id = JSON.stringify([row.surface,row.storeId,row.placeId,row.keywordKey,parent??'unresolved:'+row.scanId]);
      const group = groups.get(id) ?? []; group.push(row); groups.set(id,group);
    }
    return [...groups].map(([id, group]): KeywordMetricRound => {
      const latest = new Map<string, HistoryObservation>();
      for (const row of group.slice().sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.observationId.localeCompare(b.observationId))) latest.set(row.pointId,row);
      const selected = [...latest.values()].sort((a,b)=>a.pointId.localeCompare(b.pointId));
      const times = selected.map(o=>o.observedAt).sort();
      const profiles = new Set(selected.filter(qualified).map(o=>JSON.stringify([o.source.profileHash,o.source.adapterVersion,o.locationMode])));
      const result: KeywordMetricRound = {id,scanId:parentScan(selected[0]!)??selected[0]!.scanId,observedAt:times[0]!,observedTo:times.at(-1)!,rows:selected,
        scopePoints:scope.length,observed:selected.length,solv:null,arp:null,atrp:null,solvPoints:0,arpPoints:0,atrpPoints:0,
        cohorts:{solv:null,arp:null,atrp:null},reason:!complete?'历史尚未完整加载':!parentScan(selected[0]!)?'无法确认所属采集轮次':profiles.size>1?'本轮采集条件不一致':null};
      if (result.reason) return result;
      const values: Record<KeywordMetric, Array<{row:HistoryObservation;value:number}>> = {solv:[],arp:[],atrp:[]};
      for (const row of selected) {
        const q = row.quality;
        if (!qualified(row) || !q) continue;
        const rank=row.rank.organicRank;
        if (row.rank.status==='ranked' && Number.isSafeInteger(rank) && rank!>0) {
          values.solv.push({row,value:rank!<=3?1:0});
          if(rank!<=20)values.arp.push({row,value:rank!});
          values.atrp.push({row,value:Math.min(rank!,21)});
        } else if (['not_found','not_found_in_prefix','ad_only'].includes(row.rank.status) && ['captured','complete','partial'].includes(row.rank.listingStatus)) {
          // Display positions include ads and cannot prove organic depth.
          const coverage=Number.isSafeInteger(q.organicCoverage)?q.organicCoverage!:0;
          if(q.endOfResults===true || coverage>=3)values.solv.push({row,value:0});
          if(q.endOfResults===true || coverage>=20)values.atrp.push({row,value:21});
        }
      }
      for (const metric of ['solv','arp','atrp'] as const) {
        result[`${metric}Points`] = values[metric].length;
        // ATRP cannot silently omit weaker/unassessed points from the selected scope.
        if (metric==='atrp' && values.atrp.length!==scope.length) continue;
        result[metric]=mean(values[metric].map(x=>x.value));
        if(result[metric]!==null)result.cohorts[metric]=JSON.stringify([scope,selected.map(o=>[o.pointId,o.cohortKey]),values[metric].map(x=>x.row.pointId)]);
      }
      return result;
    }).sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.id.localeCompare(b.id));
  };
  const segments = (rows: KeywordMetricRound[], metric: KeywordMetric, maxGapHours = 3): KeywordMetricRound[][] => {
    const result: KeywordMetricRound[][]=[]; let previous:KeywordMetricRound|null=null;
    for(const row of rows){
      if(row[metric]===null || !row.cohorts[metric]){previous=null;continue;}
      if(previous && previous.cohorts[metric]===row.cohorts[metric] && Date.parse(row.observedAt)-Date.parse(previous.observedAt)<=maxGapHours*3600000)result.at(-1)!.push(row);
      else result.push([row]);
      previous=row;
    }
    return result;
  };
  return {rounds,segments};
}
