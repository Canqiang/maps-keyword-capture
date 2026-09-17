/** Initial contracts only. No live capture implementation exists yet. */
export interface CaptureConfig {
  schemaVersion: "1";
  keywords: string[];
  /** Positive integer; counts both ads and organic listings. Default 15. */
  maxResultsPerKeyword: number;
  /** Default 6. */
  maxScrollsPerKeyword: number;
  /** Upper bound on saved results screenshots per query attempt. Default 5. */
  maxScreenshotsPerKeyword: number;
  keywordTimeoutMs: number;
  locale: string;
  browserTimezoneId: string;
  filenameTimezone: string;
  viewport: { width: number; height: number };
  outputDirectory: string;
  /**
   * Reserved optional map view for a future explicit area-search mode.
   * Omit for query-only search. The first runner must reject a supplied value
   * until that mode is implemented; never silently apply or ignore it.
   */
  mapView?: { latitude: number; longitude: number; zoom: number };
}

export type ListingClassification =
  | { resultType: "ad"; adLabel: string; organicRank: null }
  | { resultType: "organic"; adLabel: null; organicRank: number | null }
  | { resultType: "unknown"; adLabel: string | null; organicRank: null };

export type Listing = ListingClassification & {
  /** Identity of this occurrence; an ad and organic result are separate occurrences. */
  occurrenceId: string;
  /** One-based observed list order, including ads. */
  displayPosition: number;
  name: string;
  address: string | null;
  mapsUrl: string | null;
  /** Nullable if the page does not expose a reliable merchant identifier. */
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  rawText: string;
  screenshotIds: string[];
};

export interface ScreenshotArtifact {
  id: string;
  filename: string;
  capturedAt: string;
  kind: "results" | "diagnostic";
  bytes: number;
  sha256: string;
  objectKey: string | null;
  storageStatus: "local_only" | "uploaded" | "verified" | "failed";
}

export type StopReason =
  | "limit_reached"
  | "end_of_results"
  | "scroll_limit"
  | "load_stalled"
  | "timeout"
  | "captcha"
  | "consent_required"
  | "error";

export interface KeywordResult {
  schemaVersion: "1";
  runId: string;
  queryId: string;
  keyword: string;
  startedAt: string;
  finishedAt: string;
  status: "captured" | "partial" | "blocked" | "failed";
  stopReason: StopReason;
  requestedLimit: number;
  observedCount: number;
  /** True only when order from the first result through the last is verified. */
  sequenceVerified: boolean;
  finalUrl: string | null;
  browserVersion: string | null;
  context: {
    locale: string;
    browserTimezoneId: string;
    viewport: CaptureConfig["viewport"];
    locationMode: "query_only";
    /** No location override in the first version; observed location is separate. */
    configuredMapView: null;
    loggedIn: false;
    egressRegion: string | null;
    observedLocationText: string | null;
    filters: string[];
  };
  listings: Listing[];
  screenshots: ScreenshotArtifact[];
  error: { code: string; message: string } | null;
}

export interface BatchManifest {
  schemaVersion: "1";
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "partial" | "failed";
  queries: {
    queryId: string;
    keyword: string;
    status: "pending" | "running" | KeywordResult["status"];
    resultFile: string | null;
    persistenceStatus: "pending" | "not_requested" | "verified" | "failed";
  }[];
}
