import type { KeywordResult } from '../contracts.js';

export const CSV_COLUMNS = [
  'run_id', 'attempt_id', 'query_id', 'keyword', 'captured_at', 'profile_hash',
  'display_position', 'result_type', 'organic_rank', 'name', 'address', 'rating',
  'review_count', 'category', 'maps_url', 'place_id', 'ad_label', 'screenshot_files', 'geographic_status',
] as const;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  let text = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function resultToCsv(result: KeywordResult): string {
  const filenameById = new Map(result.screenshots.map((s) => [s.id, s.filename]));
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const l of result.listings) {
    const files = l.screenshotIds.map((id) => filenameById.get(id) ?? id).join(';');
    const cells: (string | number | null)[] = [
      result.runId, result.attemptId, result.queryId, result.keyword, result.finishedAt, result.metadata.profileHash,
      l.displayPosition, l.resultType, l.organicRank, l.name, l.address, l.rating,
      l.reviewCount, l.category, l.mapsUrl, l.placeId, l.adLabel, files, result.quality.geographicRelevance?.status ?? 'unverified',
    ];
    rows.push(cells.map(csvEscape).join(','));
  }
  return `﻿${rows.join('\r\n')}\r\n`;
}
