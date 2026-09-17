import type { BoundingBox, ObservedCard } from '../contracts.js';

export interface RawSponsoredLabel { text: string; ownerAriaLabel: string | null; depth: number }

/** One direct child of div[role="feed"], as read inside the page. */
export interface RawFeedChild {
  index: number;
  tag: string;
  heightPx: number;
  bounds: BoundingBox;            // viewport coordinates
  placeHref: string | null;       // first a[href*="/maps/place/"]
  placeAriaLabel: string | null;  // its aria-label (business name)
  ratingAriaLabel: string | null; // e.g. "4.8 stars"
  text: string;                   // innerText, whitespace collapsed
  sponsoredLabels: RawSponsoredLabel[];
}

export interface FeedSnapshot {
  children: RawFeedChild[];
  paneBounds: BoundingBox;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  endOfList: boolean;
  observedQueryText: string | null;
  pageTitle: string;
  url: string;
}

export type FeedChildKind = 'header' | 'card' | 'separator' | 'trailer' | 'unsupported';

export interface FeedLayout {
  firstCardIndex: number;
  stride: number;
  kinds: Map<number, FeedChildKind>;
  cards: RawFeedChild[];
}

export type FeedLayoutResult =
  | { ok: true; layout: FeedLayout }
  | { ok: false; reason: 'no_cards' | 'unsupported_layout'; detail: string };

export interface ParsedCardFields {
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  address: string | null;
}

/** ObservedCard plus the parsed listing fields the export needs. */
export type ClassifiedCard = ObservedCard & { parsed: ParsedCardFields };
