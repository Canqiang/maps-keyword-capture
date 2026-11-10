import { organicRankForMetrics, observationCohortKey, type RankObservation } from '../domain/model.js';

/** Compact, query-scoped facts. Missing competitors are never assigned an invented numeric rank. */
export function competitorHistory(observations: RankObservation[]) {
  const businesses = new Map<string, {placeId: string; name: string; appearances: number}>();
  const rows = observations.map(o => {
    const q = o.quality;
    const eligible = !!q && q.rankingReliable === true && q.sequenceVerified === true && q.classificationComplete === true
      && (q.screenshotCoverageComplete === true || (q.screenshotPolicy?.version === 'target-organic-top10/v1' && q.screenshotPolicy.satisfied === true))
      && !['failed','blocked','skipped'].includes(o.rank.listingStatus)
      && !['outside','mixed'].includes(q.geographicRelevance?.status ?? '');
    const values = new Map<string, {placeId: string; organicRank: number | null; adDisplayPositions: number[]; absenceConfirmed?: boolean}>();
    for (const l of o.topListings) {
      if (!l.placeId || !/^ChIJ[\w-]+$/.test(l.placeId)) continue;
      const value = values.get(l.placeId) ?? {placeId:l.placeId,organicRank:null,adDisplayPositions:[]};
      if (eligible && l.resultType === 'organic' && Number.isSafeInteger(l.organicRank) && l.organicRank! > 0)
        value.organicRank = Math.min(value.organicRank ?? Infinity, l.organicRank!);
      if (eligible && l.resultType === 'ad') value.adDisplayPositions.push(l.displayPosition);
      values.set(l.placeId,value);
      const known = businesses.get(l.placeId) ?? {placeId:l.placeId,name:l.name || l.placeId,appearances:0};
      if (l.name) known.name=l.name;
      businesses.set(l.placeId,known);
    }
    const ownRank = organicRankForMetrics(o);
    if (ownRank !== undefined) {
      const own = values.get(o.placeId) ?? {placeId:o.placeId, organicRank:null, adDisplayPositions:[]};
      own.organicRank = ownRank; own.absenceConfirmed = ownRank === null;
      own.adDisplayPositions = o.rank.adDisplayPositions ?? own.adDisplayPositions;
      values.set(o.placeId, own);
      if (!businesses.has(o.placeId)) businesses.set(o.placeId,{placeId:o.placeId,name:'本店',appearances:0});
    }
    for (const id of values.keys()) businesses.get(id)!.appearances++;
    const key=o.evidence.manifestKey??'';
    const parent=/^tracking\/(web|android)\/\d{4}-\d{2}-\d{2}\/point\/(scan_[A-Za-z0-9_-]+)\//u.exec(key);
    const parentScanId=parent && parent[1]===o.surface && key.endsWith('/manifest.json') && key.includes('/'+o.scanId+'/')
      && !key.split('/').some(x=>x==='..'||x==='.') ? parent[2]! : null;
    return {observationId:o.observationId, observedAt:o.observedAt, localDate:o.localDate, pointId:o.pointId,
      parentScanId, scopeKey:JSON.stringify([o.storeId,o.placeId,o.surface,o.keywordKey]),
      profile:JSON.stringify([o.source.profileHash,o.source.adapterVersion,o.locationMode]),
      metricEligible:eligible && o.locationMode!=='query_only' && !o.gridRunId && !o.gridSpec,
      organicCoverage:q?.organicCoverage??0, endOfResults:q?.endOfResults===true,
      cohortKey:observationCohortKey(o),
      geography:q?.geographicRelevance?.status ?? 'unverified',eligible,
      completeListingIndex:eligible && o.topListings.length === o.rank.listingsObserved && o.topListings.every(l => !!l.placeId && /^ChIJ[\w-]+$/.test(l.placeId)),
      indexedListings:o.topListings.length, listingsObserved:o.rank.listingsObserved,
      values:[...values.values()]};
  });
  return {businesses:[...businesses.values()].sort((a,b)=>b.appearances-a.appearances||a.placeId.localeCompare(b.placeId)),rows};
}
