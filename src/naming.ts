export function keywordSlug(keyword: string, maxLength = 60): string {
  const normalized = keyword.normalize('NFKC').toLowerCase();
  let slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'keyword';
}

interface Parts { year: string; month: string; day: string; hour: string; minute: string; second: string; offset: string }

function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'longOffset',
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  const raw = map['timeZoneName'] ?? 'GMT';
  const match = /GMT([+-]\d{2}):(\d{2})/.exec(raw);
  const offset = match ? `${match[1]}:${match[2]}` : '+00:00';
  return {
    year: map['year'] ?? '0000', month: map['month'] ?? '00', day: map['day'] ?? '00',
    hour: map['hour'] ?? '00', minute: map['minute'] ?? '00', second: map['second'] ?? '00',
    offset,
  };
}

function millis(date: Date): string {
  return String(date.getUTCMilliseconds()).padStart(3, '0');
}

export function filenameTimestamp(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}.${millis(date)}${p.offset.replace(':', '')}`;
}

export function isoWithOffset(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${millis(date)}${p.offset}`;
}

export function dateFolder(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function resultBaseName(date: Date, timeZone: string, keyword: string, queryId: string): string {
  return `${filenameTimestamp(date, timeZone)}__${keywordSlug(keyword)}__${queryId}`;
}

export function screenshotFileName(baseName: string, n: number): string {
  return `${baseName}__${String(n).padStart(2, '0')}.png`;
}

export function attemptRelativeDir(date: Date, timeZone: string, runId: string, attemptId: string): string {
  return `maps-keyword-capture/${dateFolder(date, timeZone)}/${runId}/${attemptId}`;
}

export function queryAttemptRelativeDir(queryId: string, queryAttemptId: string): string {
  return `${queryId}/${queryAttemptId}`;
}
