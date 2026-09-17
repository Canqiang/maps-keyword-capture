/** Unreleased v1 contracts. No collector or runtime validator exists yet.
 * Numeric ranges, timestamps, hashes, cross-references, and quality invariants
 * require runtime validation; TypeScript alone does not validate external JSON.
 */
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

/** Browser/profile identity; unavailable runtime details remain null. */
export interface RunMetadata {
  configHash: string;
  profileHash: string;
  adapterVersion: string;
  sourceCommit: string | null;
  browserVersion: string | null;
  imageDigest: string | null;
  egressProfileId: string | null;
}

export interface ClassificationEvidence {
  source: "card_label" | "placement_label" | "supported_layout" | "unresolved";
  /** Identifies which card or enclosing placement owns the label. */
  owner: string | null;
  labelText: string | null;
  layoutSignature: string | null;
  evaluatedLabelLocations: string[];
  observationIds: string[];
}

export type Listing = ListingClassification & {
  /** Ad and organic appearances of one business have separate identities. */
  occurrenceId: string;
  businessKey: string | null;
  /** One-based position within the verified prefix, including ads. */
  displayPosition: number;
  name: string;
  address: string | null;
  mapsUrl: string | null;
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  rawText: string;
  classificationEvidence: ClassificationEvidence;
  observationIds: string[];
  screenshotIds: string[];
};

export interface CaptureError { code: string; message: string }

export type StorageState =
  | { storageStatus: "local_only"; objectKey: null; verifiedAt: null; storageError: null }
  | { storageStatus: "uploaded"; objectKey: string; verifiedAt: null; storageError: null }
  | { storageStatus: "verified"; objectKey: string; verifiedAt: string; storageError: null }
  | { storageStatus: "failed"; objectKey: string | null; verifiedAt: null; storageError: CaptureError };

/** The final manifest excludes itself; its readback receipt is external. */
export type ArtifactKind =
  | "results" | "diagnostic" | "derived_crop"
  | "request_json" | "result_json" | "result_csv" | "observations_jsonl";

export type Artifact = StorageState & {
  id: string;
  filename: string;
  kind: ArtifactKind;
  bytes: number;
  sha256: string;
  queryId: string | null;
  queryAttemptId: string | null;
};

export type ScreenshotArtifact = Artifact & {
  kind: "results" | "diagnostic";
  capturedAt: string;
  width: number;
  height: number;
  observationId: string | null;
};

export interface BoundingBox { x: number; y: number; width: number; height: number }

/** Raw observations may contain unmatched cards without a claimed global rank. */
export interface ObservedCard {
  fingerprint: string;
  feedChildIndex: number;
  occurrenceId: string | null;
  businessKey: string | null;
  name: string | null;
  mapsUrl: string | null;
  rawText: string;
  bounds: BoundingBox;
  fullyVisible: boolean;
  classification: ListingClassification;
  classificationEvidence: ClassificationEvidence;
}

export interface Observation {
  observationId: string;
  runId: string;
  attemptId: string;
  queryId: string;
  queryAttemptId: string;
  observedAt: string;
  scrollOffset: number;
  paneBounds: BoundingBox;
  preSignature: string;
  postSignature: string;
  accepted: boolean;
  rejectionReason: string | null;
  cards: ObservedCard[];
  screenshotIds: string[];
}

export type CompleteReason = "limit_reached" | "end_of_results";
export type BlockReason = "captcha" | "consent_required";
export type IncompleteReason =
  | "scroll_limit" | "load_stalled" | "timeout" | "error"
  | "unsupported_layout" | "unstable_results" | "sequence_ambiguous"
  | "screenshot_limit" | "artifact_limit" | "query_mismatch"
  | "classification_unknown" | "cancelled" | "batch_timeout";
export type SkipReason =
  | "batch_blocked" | "browser_startup_failed" | "storage_unavailable"
  | "unsupported_layout" | "batch_timeout" | "cancelled";
export type StopReason = CompleteReason | BlockReason | IncompleteReason | SkipReason;

export type CollectionOutcome =
  | { status: "captured"; stopReason: CompleteReason; error: null }
  | { status: "partial"; stopReason: IncompleteReason; error: CaptureError | null }
  | { status: "blocked"; stopReason: BlockReason; error: CaptureError | null }
  | { status: "failed"; stopReason: IncompleteReason | "browser_startup_failed"; error: CaptureError };

export interface SearchContext {
  locale: string;
  browserTimezoneId: string;
  viewport: CaptureConfig["viewport"];
  deviceScaleFactor: number;
  locationMode: "query_only";
  configuredMapView: null;
  /** The resulting map view is not proof of the searcher's location. */
  observedMapView: { latitude: number; longitude: number; zoom: number | null } | null;
  loggedIn: false;
  geolocationPermission: "not_granted";
  egressRegion: string | null;
  egressSource: string | null;
  observedLocationText: string | null;
  filters: string[];
}

export interface QueryQuality {
  verifiedPrefixLength: number;
  classificationComplete: boolean;
  screenshotCoverageComplete: boolean;
  /** Preserve evidence for human review; warnings are not automatic diagnoses. */
  warnings: { code: string; message: string; observationIds: string[] }[];
  observedQueryText: string | null;
  queryCorrectionText: string | null;
}

/** Each result belongs to exactly one browser attempt, never a merged list. */
export type KeywordResult = CollectionOutcome & {
  schemaVersion: "1";
  runId: string;
  attemptId: string;
  queryId: string;
  queryAttemptId: string;
  keyword: string;
  startedAt: string;
  finishedAt: string;
  requestedLimit: number;
  /** Number of emitted listings; raw/unmatched cards live in observations. */
  observedCount: number;
  sequenceVerified: boolean;
  finalUrl: string | null;
  metadata: RunMetadata;
  context: SearchContext;
  quality: QueryQuality;
  listings: Listing[];
  screenshots: ScreenshotArtifact[];
  observationArtifactIds: string[];
};

export type QueryAttemptSummary = CollectionOutcome & {
  queryAttemptId: string;
  startedAt: string;
  finishedAt: string;
  /** Per-attempt result JSON, including unsuccessful attempts. */
  resultFile: string;
  artifactIds: string[];
};

export type PersistenceStatus = "pending" | "not_requested" | "verified" | "failed";

type QueryRowIdentity = {
  queryId: string;
  /** Zero-based original input row; duplicate keywords remain separate. */
  inputIndex: number;
  keyword: string;
};

export type QueryManifestEntry = QueryRowIdentity & (
  | { status: "pending" | "running"; stopReason: null;
      selectedQueryAttemptId: null; attempts: QueryAttemptSummary[];
      resultFile: null; artifactIds: string[]; persistenceStatus: "pending" | "not_requested" }
  | { status: "skipped"; stopReason: SkipReason;
      selectedQueryAttemptId: null; attempts: []; resultFile: null;
      artifactIds: []; persistenceStatus: "not_requested" }
  | (CollectionOutcome & {
      selectedQueryAttemptId: string;
      attempts: [QueryAttemptSummary, ...QueryAttemptSummary[]];
      resultFile: string;
      artifactIds: string[];
      persistenceStatus: PersistenceStatus;
    })
);

export interface BatchManifest {
  schemaVersion: "1";
  runId: string;
  attemptId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "partial" | "failed";
  metadata: RunMetadata;
  persistenceMode: "local_only" | "azure_blob";
  queries: QueryManifestEntry[];
  /** All artifacts including failed/unselected attempts; excludes this manifest. */
  artifacts: Artifact[];
}

/** Printed by the CLI after publishing; never embedded in the manifest itself. */
export type ManifestDeliveryReceipt = StorageState & {
  runId: string;
  attemptId: string;
  filename: string;
  bytes: number;
  sha256: string;
};
