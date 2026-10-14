import { hashJson } from '../ids.js';
import type { EnrolledStore, MonitorConfig, MonitoringKeywordSet } from './config.js';
import { SELECTION_POLICY, selectKeywords, type KeywordRecord, type SourceKeyword } from './source.js';

export interface MonitoringCohort {
  id: string;
  sha256: string;
  groups: Record<MonitoringKeywordSet['keywords'][number]['group'], number>;
}
interface MonitoringKeyword {
  keyword: string;
  // No shared-library priority or source-array position is fabricated for an override.
  priority: null;
  sourceIndex: null;
  cohortIndex: number;
  monitoringGroup: MonitoringKeywordSet['keywords'][number]['group'];
}
interface StoreSelection {
  keywords: (SourceKeyword | MonitoringKeyword)[];
  availableCount: number;
  duplicateCount: number;
  unknownPriorityCount: number;
  selectionPolicy: string;
  monitoringCohort?: MonitoringCohort;
}

/** Shared-library reads remain mandatory; an explicit cohort replaces only the selected list. */
export function selectStoreKeywords(record: KeywordRecord, store: EnrolledStore, config: MonitorConfig): StoreSelection {
  const cohort = config.monitoringKeywordSets?.find(s => s.placeId === store.placeId);
  if (!cohort) return { ...selectKeywords(record.keywords, config.maxKeywordsPerStore), selectionPolicy: SELECTION_POLICY };
  if (cohort.merchantId !== store.merchantId) throw new Error('source_monitoring_cohort_identity_mismatch');
  const groups: MonitoringCohort['groups'] = { core: 0, exploration: 0, brand: 0 };
  const keywords = cohort.keywords.map((k, cohortIndex): MonitoringKeyword => {
    groups[k.group]++;
    return { keyword: k.keyword, priority: null, sourceIndex: null, cohortIndex, monitoringGroup: k.group };
  });
  return {
    keywords, availableCount: keywords.length, duplicateCount: 0, unknownPriorityCount: 0,
    selectionPolicy: 'monitoring_cohort/v1: exact configured order; identity-bound; no shared-library mutation or truncation',
    monitoringCohort: { id: cohort.id, sha256: hashJson(cohort), groups },
  };
}
