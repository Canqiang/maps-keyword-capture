import type { Listing, ListingClassification } from '../contracts.js';
import type { CommittedCard } from './reconcile.js';

export interface RankedCard { committed: CommittedCard; displayPosition: number; organicRank: number | null }

export function assignRanks(committed: CommittedCard[]): { ranked: RankedCard[]; classificationComplete: boolean } {
  const ranked: RankedCard[] = [];
  let organicCounter = 0;
  let afterUnknown = false;
  for (const [i, entry] of committed.entries()) {
    const type = entry.card.classification.resultType;
    if (type === 'unknown') afterUnknown = true;
    let organicRank: number | null = null;
    if (type === 'organic' && !afterUnknown) {
      organicCounter += 1;
      organicRank = organicCounter;
    }
    ranked.push({ committed: entry, displayPosition: i + 1, organicRank });
  }
  return { ranked, classificationComplete: !afterUnknown };
}

function classificationFor(r: RankedCard): ListingClassification {
  const c = r.committed.card.classification;
  switch (c.resultType) {
    case 'ad': return { resultType: 'ad', adLabel: c.adLabel, organicRank: null };
    case 'organic': return { resultType: 'organic', adLabel: null, organicRank: r.organicRank };
    case 'unknown': return { resultType: 'unknown', adLabel: c.adLabel, organicRank: null };
  }
}

export function toListing(r: RankedCard, screenshotIds: string[]): Listing {
  const card = r.committed.card;
  return {
    ...classificationFor(r),
    occurrenceId: card.occurrenceId ?? '',
    businessKey: card.businessKey,
    displayPosition: r.displayPosition,
    name: card.name ?? '',
    address: card.parsed.address,
    mapsUrl: card.mapsUrl,
    placeId: card.parsed.placeId,
    rating: card.parsed.rating,
    reviewCount: card.parsed.reviewCount,
    category: card.parsed.category,
    rawText: card.rawText,
    classificationEvidence: { ...card.classificationEvidence, observationIds: [...r.committed.observationIds] },
    observationIds: [...r.committed.observationIds],
    screenshotIds: [...screenshotIds],
  };
}
