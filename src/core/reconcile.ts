import type { QueryQuality } from '../contracts.js';
import type { ClassifiedCard, FeedLayout } from './types.js';

export interface ReconcileRound { observationId: string; layout: FeedLayout; cards: ClassifiedCard[] }
export interface CommittedCard { card: ClassifiedCard; observationIds: string[] }
export interface ReconcileFailure { reason: 'sequence_ambiguous' | 'unsupported_layout'; detail: string; atIndex: number | null }
export interface ReconcileState {
  committed: CommittedCard[];
  stride: number | null;
  firstCardIndex: number | null;
  failure: ReconcileFailure | null;
  warnings: QueryQuality['warnings'];
}

export function createReconcileState(): ReconcileState {
  return { committed: [], stride: null, firstCardIndex: null, failure: null, warnings: [] };
}

export function lastCommittedIndex(state: ReconcileState): number | null {
  const last = state.committed[state.committed.length - 1];
  return last ? last.card.feedChildIndex : null;
}

function identityKey(card: ClassifiedCard): string {
  return card.businessKey ?? card.mapsUrl ?? `feed-child:${card.feedChildIndex}`;
}

function fail(state: ReconcileState, committed: CommittedCard[], failure: ReconcileFailure): ReconcileState {
  return { ...state, committed, failure };
}

export function applyRound(state: ReconcileState, round: ReconcileRound, limit: number): ReconcileState {
  if (state.failure) return state;
  const cards = [...round.cards].sort((a, b) => a.feedChildIndex - b.feedChildIndex);

  // 1. The card stride must not change between rounds.
  const stride = state.stride ?? round.layout.stride;
  const firstCardIndex = state.firstCardIndex ?? round.layout.firstCardIndex;
  if (round.layout.stride !== stride) {
    return fail(state, state.committed, { reason: 'unsupported_layout', detail: `card stride changed from ${stride} to ${round.layout.stride}`, atIndex: null });
  }

  // 2. Visual order must follow index order.
  for (let i = 1; i < cards.length; i++) {
    if (cards[i]!.bounds.y <= cards[i - 1]!.bounds.y) {
      return fail(state, state.committed, { reason: 'sequence_ambiguous', detail: `card at index ${cards[i]!.feedChildIndex} is not below index ${cards[i - 1]!.feedChildIndex}`, atIndex: cards[i]!.feedChildIndex });
    }
  }

  const byIndex = new Map<number, ClassifiedCard>(cards.map((c) => [c.feedChildIndex, c]));
  const roundMin = cards[0]?.feedChildIndex ?? Number.POSITIVE_INFINITY;
  const roundMax = cards[cards.length - 1]?.feedChildIndex ?? Number.NEGATIVE_INFINITY;
  const knownOccurrenceIndex = new Map(state.committed.map((c) => [c.card.occurrenceId, c.card.feedChildIndex]));

  // 3 and 4. Re-verify the committed prefix.
  const committed: CommittedCard[] = [];
  for (const entry of state.committed) {
    const idx = entry.card.feedChildIndex;
    const seen = byIndex.get(idx);
    if (!seen) {
      if (idx >= roundMin && idx <= roundMax) {
        return fail(state, committed, { reason: 'sequence_ambiguous', detail: `committed card at index ${idx} disappeared`, atIndex: idx });
      }
      committed.push(entry);
      continue;
    }
    const same = identityKey(seen) === identityKey(entry.card)
      && (seen.classification.resultType === 'ad') === (entry.card.classification.resultType === 'ad')
      && seen.name === entry.card.name;
    if (!same) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `card at index ${idx} changed from "${entry.card.name}" to "${seen.name}"`, atIndex: idx });
    }
    committed.push({ card: entry.card, observationIds: [...entry.observationIds, round.observationId] });
  }
  for (const c of cards) {
    const knownAt = knownOccurrenceIndex.get(c.occurrenceId);
    if (knownAt !== undefined && knownAt !== c.feedChildIndex) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `occurrence ${c.occurrenceId} moved from index ${knownAt} to ${c.feedChildIndex}`, atIndex: c.feedChildIndex });
    }
  }

  // 5. Append a contiguous new suffix.
  let expected = committed.length === 0 ? firstCardIndex : committed[committed.length - 1]!.card.feedChildIndex + stride;
  for (const c of cards) {
    if (committed.length >= limit) break;
    if (c.feedChildIndex < expected) continue;
    if (c.feedChildIndex !== expected) {
      return fail(state, committed, { reason: 'sequence_ambiguous', detail: `expected card at index ${expected}, found ${c.feedChildIndex}`, atIndex: c.feedChildIndex });
    }
    committed.push({ card: c, observationIds: [round.observationId] });
    expected += stride;
  }

  return { ...state, committed, stride, firstCardIndex };
}
