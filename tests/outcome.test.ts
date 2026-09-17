import { describe, expect, it } from 'vitest';
import { deriveOutcome, type OutcomeInput } from '../src/core/outcome.js';

const good = { sequenceVerified: true, classificationComplete: true, screenshotCoverageComplete: true, listingCount: 15 };

describe('deriveOutcome', () => {
  const cases: [string, OutcomeInput, Record<string, unknown>][] = [
    ['limit reached', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good }, { status: 'captured', stopReason: 'limit_reached', error: null }],
    ['end of results with 7', { stop: { kind: 'complete', reason: 'end_of_results' }, ...good, listingCount: 7 }, { status: 'captured', stopReason: 'end_of_results' }],
    ['unknown classification', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, classificationComplete: false }, { status: 'partial', stopReason: 'classification_unknown' }],
    ['missing screenshot coverage', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, screenshotCoverageComplete: false }, { status: 'partial', stopReason: 'screenshot_limit' }],
    ['unverified sequence', { stop: { kind: 'complete', reason: 'limit_reached' }, ...good, sequenceVerified: false }, { status: 'partial', stopReason: 'sequence_ambiguous' }],
    ['scroll limit', { stop: { kind: 'incomplete', reason: 'scroll_limit', error: null }, ...good, listingCount: 9 }, { status: 'partial', stopReason: 'scroll_limit' }],
    ['timeout with evidence', { stop: { kind: 'incomplete', reason: 'timeout', error: null }, ...good, listingCount: 3 }, { status: 'partial', stopReason: 'timeout' }],
    ['timeout without evidence', { stop: { kind: 'incomplete', reason: 'timeout', error: null }, ...good, listingCount: 0 }, { status: 'failed', stopReason: 'timeout', error: { code: 'timeout', message: expect.any(String) } }],
    ['cancelled with evidence', { stop: { kind: 'incomplete', reason: 'cancelled', error: null }, ...good, listingCount: 4 }, { status: 'partial', stopReason: 'cancelled' }],
    ['cancelled without evidence', { stop: { kind: 'incomplete', reason: 'cancelled', error: null }, ...good, listingCount: 0 }, { status: 'failed', stopReason: 'cancelled', error: { code: 'cancelled', message: expect.any(String) } }],
    ['captcha', { stop: { kind: 'blocked', reason: 'captcha', error: null }, ...good, listingCount: 0 }, { status: 'blocked', stopReason: 'captcha' }],
    ['browser startup', { stop: { kind: 'failed', reason: 'browser_startup_failed', error: { code: 'launch', message: 'x' } }, ...good, listingCount: 0 }, { status: 'failed', stopReason: 'browser_startup_failed' }],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(deriveOutcome(input)).toMatchObject(expected));
  }
});
