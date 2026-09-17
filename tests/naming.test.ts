import { describe, expect, it } from 'vitest';
import {
  attemptRelativeDir, dateFolder, filenameTimestamp, isoWithOffset, keywordSlug,
  queryAttemptRelativeDir, resultBaseName, screenshotFileName,
} from '../src/naming.js';

const at = new Date('2026-09-17T06:30:25.123Z');

describe('naming', () => {
  it('slugs keywords', () => {
    expect(keywordSlug('Bubble Tea  Garden City')).toBe('bubble-tea-garden-city');
    expect(keywordSlug('  fried chicken / mineola!  ')).toBe('fried-chicken-mineola');
    expect(keywordSlug('ｍａｔｃｈａ ｍｉｎｅｏｌａ')).toBe('matcha-mineola');
    expect(keywordSlug('奶茶 garden city')).toBe('garden-city');
    expect(keywordSlug('奶茶')).toBe('keyword');
    expect(keywordSlug('a'.repeat(100))).toHaveLength(60);
    expect(keywordSlug('x'.repeat(59) + ' yz')).toBe('x'.repeat(59));
  });

  it('formats timestamps in the configured timezone with offset', () => {
    expect(filenameTimestamp(at, 'Asia/Shanghai')).toBe('20260917T143025.123+0800');
    expect(filenameTimestamp(at, 'America/New_York')).toBe('20260917T023025.123-0400');
    expect(isoWithOffset(at, 'Asia/Shanghai')).toBe('2026-09-17T14:30:25.123+08:00');
    expect(dateFolder(at, 'Asia/Shanghai')).toBe('2026-09-17');
    expect(dateFolder(new Date('2026-09-17T17:30:00Z'), 'Asia/Shanghai')).toBe('2026-09-18');
  });

  it('builds file and directory names', () => {
    const base = resultBaseName(at, 'Asia/Shanghai', 'bubble tea garden city', 'q0001');
    expect(base).toBe('20260917T143025.123+0800__bubble-tea-garden-city__q0001');
    expect(screenshotFileName(base, 1)).toBe(`${base}__01.png`);
    expect(attemptRelativeDir(at, 'Asia/Shanghai', 'run_x', 'att_y')).toBe('maps-keyword-capture/2026-09-17/run_x/att_y');
    expect(queryAttemptRelativeDir('q0001', 'qa01')).toBe('q0001/qa01');
  });
});
