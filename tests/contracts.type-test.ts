import type {
  Artifact, BatchManifest, CaptureConfig, CollectionOutcome, KeywordResult,
  ListingClassification, Observation, QueryManifestEntry, StopReason,
} from '../src/contracts.js';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Not<T extends boolean> = T extends true ? false : true;
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;

// Business invariants: a paid placement never receives an organic rank.
type AdCannotRank = Assert<Not<Extends<{
  resultType: 'ad'; adLabel: 'Sponsored'; organicRank: 1;
}, ListingClassification>>>;
type UnknownCannotRank = Assert<Not<Extends<{
  resultType: 'unknown'; adLabel: null; organicRank: 1;
}, ListingClassification>>>;
type AdWithEvidence = Assert<Extends<{
  resultType: 'ad'; adLabel: 'Sponsored'; organicRank: null;
}, ListingClassification>>;

// Collection success cannot be claimed when an evidence budget is exhausted.
type LimitSuccess = Assert<Extends<{
  status: 'captured'; stopReason: 'limit_reached'; error: null;
}, CollectionOutcome>>;
type ScreenshotBudgetIsNotSuccess = Assert<Not<Extends<{
  status: 'captured'; stopReason: 'screenshot_limit'; error: null;
}, CollectionOutcome>>>;
type CaptchaIsBlocked = Assert<Extends<{
  status: 'blocked'; stopReason: 'captcha'; error: null;
}, CollectionOutcome>>;
type RequiredReasons = Assert<Extends<
  'screenshot_limit' | 'artifact_limit' | 'sequence_ambiguous' |
  'query_mismatch' | 'unsupported_layout' | 'unstable_results' | 'batch_blocked', StopReason>>;

type CancelledAfterEvidence = Assert<Extends<{
  status: 'partial'; stopReason: 'cancelled'; error: null;
}, CollectionOutcome>>;
type BatchDeadlineAfterEvidence = Assert<Extends<{
  status: 'partial'; stopReason: 'batch_timeout'; error: null;
}, CollectionOutcome>>;

// Every skipped input remains accounted for and cannot claim a result file.
type ValidSkipped = Assert<Extends<{
  queryId: 'q0002'; keyword: 'matcha mineola'; inputIndex: 1;
  status: 'skipped'; stopReason: 'batch_blocked'; selectedQueryAttemptId: null;
  attempts: []; resultFile: null; artifactIds: []; persistenceStatus: 'not_requested';
}, QueryManifestEntry>>;
type SkippedNeedsReason = Assert<Not<Extends<{
  queryId: 'q0002'; keyword: 'matcha mineola'; inputIndex: 1;
  status: 'skipped'; selectedQueryAttemptId: null; attempts: [];
  resultFile: null; artifactIds: []; persistenceStatus: 'not_requested';
}, QueryManifestEntry>>>;
type SkippedCannotHaveResults = Assert<Not<Extends<{
  queryId: 'q0002'; keyword: 'matcha mineola'; inputIndex: 1;
  status: 'skipped'; stopReason: 'batch_blocked'; selectedQueryAttemptId: null;
  attempts: []; resultFile: 'q0002.json'; artifactIds: []; persistenceStatus: 'verified';
}, QueryManifestEntry>>>;

// Upload acceptance is distinct from independent readback.
type ArtifactBase = {
  id: 'a1'; filename: 'result.json'; kind: 'result_json';
  bytes: 100; sha256: 'checksum'; queryId: 'q0001'; queryAttemptId: null;
};
type VerifiedArtifact = Assert<Extends<ArtifactBase & {
  storageStatus: 'verified'; objectKey: 'run/attempt/q0001.json';
  verifiedAt: '2026-09-17T03:00:00Z'; storageError: null;
}, Artifact>>;
type VerifiedNeedsReadbackTime = Assert<Not<Extends<ArtifactBase & {
  storageStatus: 'verified'; objectKey: 'run/attempt/q0001.json';
  verifiedAt: null; storageError: null;
}, Artifact>>>;
type VerifiedNeedsObjectKey = Assert<Not<Extends<ArtifactBase & {
  storageStatus: 'verified'; objectKey: null;
  verifiedAt: '2026-09-17T03:00:00Z'; storageError: null;
}, Artifact>>>;
type VerifiedNeedsHash = Assert<Not<Extends<Omit<ArtifactBase, 'sha256'> & {
  storageStatus: 'verified'; objectKey: 'run/attempt/q0001.json';
  verifiedAt: '2026-09-17T03:00:00Z'; storageError: null;
}, Artifact>>>;

// Preserve attempt identity, evidence binding, and requested/observed location.
type WorkerAttempt = Assert<Has<KeywordResult, 'attemptId'>>;
type QueryAttempt = Assert<Has<KeywordResult, 'queryAttemptId'>>;
type BatchAttempt = Assert<Has<BatchManifest, 'attemptId'>>;
type IndexInManifest = Assert<Has<BatchManifest, 'artifacts'>>;
type EvidenceBinding = Assert<Has<Observation, 'preSignature' | 'postSignature' | 'screenshotIds'>>;
type ProfileMetadata = Assert<Has<BatchManifest, 'metadata'>>;
// Query-only search records null; an area search records the configured map view.
type ConfiguredLocationNullable = Assert<Extends<null, KeywordResult['context']['configuredMapView']>>;
type ConfiguredLocationMapView = Assert<Extends<{ latitude: number; longitude: number; zoom: number }, KeywordResult['context']['configuredMapView']>>;
type ObservedLocationSeparate = Assert<Has<KeywordResult['context'], 'observedMapView'>>;
type QueryOnlyConfig = Assert<Extends<Omit<CaptureConfig, 'mapView'>, CaptureConfig>>;

export {};
