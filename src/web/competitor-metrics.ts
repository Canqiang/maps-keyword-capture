import type { competitorHistory } from './competitors.js';
type Row = ReturnType<typeof competitorHistory>['rows'][number];
export type CompetitorMetric = 'solv' | 'arp' | 'atrp';

/** Shared browser/test model. Parent receipts, not nearby timestamps, join point batches. */
export function createCompetitorMetricsModel() {
  function rounds(rows: Row[], pointIds: string[], businesses: string[], complete = true) {
    const scope=[...new Set(pointIds)].sort(), groups=new Map<string,Row[]>();
    for(const row of rows) {
      if(!scope.includes(row.pointId))continue;
      // Unknown provenance is a visible gap, never a reason to resurrect an older success.
      // Each unresolved observation stays isolated rather than joining by nearby timestamps.
      const key=JSON.stringify([row.scopeKey,row.parentScanId??'unresolved:'+row.observationId]);
      const group=groups.get(key)??[];group.push(row);groups.set(key,group);
    }
    return [...groups].map(([id,group])=>{
      const latest=new Map<string,Row>();
      for(const row of group.slice().sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.observationId.localeCompare(b.observationId)))latest.set(row.pointId,row);
      const selected=[...latest.values()].sort((a,b)=>a.pointId.localeCompare(b.pointId));
      const times=selected.map(r=>r.observedAt).sort();
      const profiles=new Set(selected.filter(r=>r.metricEligible).map(r=>r.profile));
      const reason=!complete?'历史尚未完整加载':!selected[0]!.parentScanId?'无法确认所属采集轮次':profiles.size>1?'本轮采集条件不一致':null;
      const values=businesses.map(placeId=>{
        const samples:Record<CompetitorMetric,Array<{row:Row;value:number}>>={solv:[],arp:[],atrp:[]};
        if(!reason)for(const row of selected) {
          if(!row.metricEligible || !row.cohortKey)continue;
          const value=row.values.find(v=>v.placeId===placeId),rank=value?.organicRank;
          if(rank!=null && Number.isSafeInteger(rank) && rank>0) {
            samples.solv.push({row,value:rank<=3?1:0});
            if(rank<=20)samples.arp.push({row,value:rank});
            samples.atrp.push({row,value:Math.min(rank,21)});
          } else if(row.completeListingIndex || value?.absenceConfirmed) {
            if(row.endOfResults || row.organicCoverage>=3)samples.solv.push({row,value:0});
            if(row.endOfResults || row.organicCoverage>=20)samples.atrp.push({row,value:21});
          }
        }
        const metrics:Record<CompetitorMetric,number|null>={solv:null,arp:null,atrp:null};
        const cohorts:Record<CompetitorMetric,string|null>={solv:null,arp:null,atrp:null};
        const points={solv:samples.solv.length,arp:samples.arp.length,atrp:samples.atrp.length};
        for(const metric of ['solv','arp','atrp'] as const) {
          if(!samples[metric].length || (metric==='atrp' && points.atrp!==scope.length))continue;
          metrics[metric]=samples[metric].reduce((sum,x)=>sum+x.value,0)/points[metric]*(metric==='solv'?100:1);
          cohorts[metric]=JSON.stringify([scope,selected.map(r=>[r.pointId,r.cohortKey]),samples[metric].map(x=>x.row.pointId)]);
        }
        return {placeId,...metrics,points,cohorts};
      });
      return {id,observedAt:times[0]!,observedTo:times.at(-1)!,localDate:selected.find(r=>r.observedAt===times[0])!.localDate,
        scopePoints:scope.length,observedPoints:selected.length,rows:selected,values,reason};
    }).sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.id.localeCompare(b.id));
  }
  return {rounds};
}
export type CompetitorMetricRound = ReturnType<ReturnType<typeof createCompetitorMetricsModel>['rounds']>[number];
