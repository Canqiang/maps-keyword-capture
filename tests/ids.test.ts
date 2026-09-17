import { describe, expect, it } from 'vitest';
import {
  canonicalJson, hashJson, newAttemptId, newRunId, observationIdFor,
  occurrenceIdFor, queryAttemptIdFor, queryIdFor, sha256Hex,
} from '../src/ids.js';

describe('ids', () => {
  it('hashes strings and buffers identically', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
  });

  it('canonicalizes object key order but not array order', () => {
    expect(canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }] })).toBe('{"a":[3,{"y":2,"z":1}],"b":1}');
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });

  it('formats ids', () => {
    expect(newRunId(new Date('2026-09-17T06:30:25.123Z'))).toMatch(/^run_20260917T063025Z_[0-9a-f]{6}$/);
    expect(newAttemptId()).toMatch(/^att_[0-9a-f]{8}$/);
    expect(queryIdFor(0)).toBe('q0001');
    expect(queryIdFor(19)).toBe('q0020');
    expect(queryAttemptIdFor(1)).toBe('qa01');
    expect(observationIdFor('qa01', 3)).toBe('qa01_obs003');
  });

  it('separates ad and organic occurrences of one place', () => {
    const a = occurrenceIdFor({ placeKey: '0x1:0x2', isAd: true, feedChildIndex: 2 });
    const b = occurrenceIdFor({ placeKey: '0x1:0x2', isAd: false, feedChildIndex: 22 });
    expect(a).toMatch(/^occ_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(occurrenceIdFor({ placeKey: '0x1:0x2', isAd: true, feedChildIndex: 2 })).toBe(a);
  });
});
