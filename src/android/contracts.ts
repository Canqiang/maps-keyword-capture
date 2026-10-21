import type { StorageState } from '../contracts.js';

export interface ObservationLocation {
  id: string; label: string; latitude: number; longitude: number;
  accuracyMeters: number; toleranceMeters: number; source: string;
}
export interface AndroidTask {
  storeId: string; storeName: string; keyword: string;
  /** Names that identify the monitored store in OCR'd result cards; storeName is the fallback. */
  aliases?: string[];
  location: ObservationLocation;
  sourceReference: string;
}
export interface AndroidCaptureConfig {
  schemaVersion: 'android-maps-input/v1';
  appiumUrl: string; adbPath: string; serial: string;
  locale: 'en-US'; timezone: string;
  outputDirectory: string;
  maxScreenshotsPerQuery: number; keywordTimeoutMs: number;
  maxDisplayedResults: number; maxScrolls: number; ocrLanguages: string; ocrTimeoutMs: number;
  tasks: AndroidTask[];
}
export interface AndroidDeviceInfo {
  serial: string; androidVersion: string; appVersion: string;
  appPackage: 'com.google.android.apps.maps';
  locale: string; timezone: string;
  emulator: boolean;
}
export interface LocationPreparation {
  homeReadyAt: string | null;
  providerReadyAt: string | null;
  injectedAt: string | null;
  beforeElapsedMs: number | null;
  observedElapsedMs: number | null;
  readbackElapsedMs: number | null;
  accuracyMeters: number | null;
  viewportStatus: 'following' | 'unverified';
  viewportAction: 'recenter_clicked' | 'already_following' | null;
  viewportCheckedAt: string | null;
}
export interface LocationEvidence {
  requested: ObservationLocation;
  injectionStatus: 'sent' | 'failed';
  deviceLocationStatus: 'matched' | 'unverified' | 'mismatch';
  observed: { latitude: number; longitude: number; provider: string } | null;
  mapsLocationStatus: 'unverified';
  checkedAt: string;
  note: string;
  /** Optional for historical evidence; adapter v2 requires a following viewport before search. */
  preparation?: LocationPreparation;
}
export interface NativeScreen {
  png: Buffer; xml: string; packageName: string; capturedAt: string;
}
/** Native geometry from the latest persisted listing frame, not OCR or ranks. */
export interface NativeScrollEvidence {
  sourceXml: string;
  listBounds: UiNode['bounds'];
  anchors: Array<{ text: string; bounds: NonNullable<UiNode['bounds']> }>;
}
export interface AndroidDevice {
  preflight(): Promise<AndroidDeviceInfo>;
  start(): Promise<void>;
  setLocation(location: ObservationLocation): Promise<LocationEvidence>;
  search(keyword: string): Promise<void>;
  snapshot(): Promise<NativeScreen>;
  /** One bounded exact-query native list gesture. Persisted evidence must still match live XML. */
  swipeResults(evidence?: NativeScrollEvidence): Promise<void>;
  close(): Promise<void>;
}
export interface UiNode {
  text: string; description: string; resourceId: string; className: string;
  packageName: string; clickable: boolean;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}
export type ScreenKind = 'results' | 'photo_discovery' | 'detail' | 'no_results' | 'blocked' | 'consent' | 'unknown';
export interface ScreenAnalysis {
  kind: ScreenKind;
  queryVisible: boolean;
  texts: string[];
  adLabels: string[];
  warnings: string[];
}
export type AndroidArtifact = StorageState & {
  relativePath: string; bytes: number; sha256: string;
  kind: 'png' | 'ui_xml' | 'query_json' | 'csv' | 'input' | 'device' | 'ocr_json' | 'screen_frame';
};
