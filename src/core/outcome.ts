import type { BlockReason, CaptureError, CollectionOutcome, CompleteReason, IncompleteReason } from '../contracts.js';

export type StopCause =
  | { kind: 'complete'; reason: CompleteReason }
  | { kind: 'incomplete'; reason: IncompleteReason; error: CaptureError | null }
  | { kind: 'blocked'; reason: BlockReason; error: CaptureError | null }
  | { kind: 'failed'; reason: IncompleteReason | 'browser_startup_failed'; error: CaptureError };

export interface OutcomeInput {
  stop: StopCause;
  sequenceVerified: boolean;
  classificationComplete: boolean;
  screenshotCoverageComplete: boolean;
  screenshotPolicySatisfied?: boolean;
  listingCount: number;
}

export function deriveOutcome(input: OutcomeInput): CollectionOutcome {
  const { stop } = input;
  switch (stop.kind) {
    case 'complete':
      if (!input.classificationComplete) return { status: 'partial', stopReason: 'classification_unknown', error: null };
      if (!(input.screenshotPolicySatisfied ?? input.screenshotCoverageComplete)) return { status: 'partial', stopReason: 'screenshot_limit', error: null };
      if (!input.sequenceVerified) return { status: 'partial', stopReason: 'sequence_ambiguous', error: null };
      return { status: 'captured', stopReason: stop.reason, error: null };
    case 'incomplete':
      if (input.listingCount === 0 && (stop.reason === 'timeout' || stop.reason === 'error' || stop.reason === 'cancelled')) {
        return { status: 'failed', stopReason: stop.reason, error: stop.error ?? { code: stop.reason, message: `no listings collected before ${stop.reason}` } };
      }
      return { status: 'partial', stopReason: stop.reason, error: stop.error };
    case 'blocked':
      return { status: 'blocked', stopReason: stop.reason, error: stop.error };
    case 'failed':
      return { status: 'failed', stopReason: stop.reason, error: stop.error };
  }
}
