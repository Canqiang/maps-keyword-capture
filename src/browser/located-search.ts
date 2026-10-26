import type { Page } from 'playwright';
import type { WebSearchLocationEvidence } from '../contracts.js';
import { detectPageState, type MapView, type PageState } from './maps-adapter.js';

export class SearchLocationError extends Error {
  constructor(message: string, readonly evidence: WebSearchLocationEvidence) { super(message); this.name = 'SearchLocationError'; }
}

/** One fresh home page, an acknowledged position, then exactly one UI search. No direct-search fallback. */
export async function openLocatedSearch(page: Page, keyword: string, locale: string, point: MapView, timeoutMs: number, signal?: AbortSignal): Promise<{ state: PageState; finalUrl: string; searchLocation: WebSearchLocationEvidence }> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    if (signal?.aborted) throw new Error('cancelled');
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error('location/search deadline exhausted');
    return ms;
  };
  const evidence: WebSearchLocationEvidence = {
    method: 'browser_gps_before_search/v1', status: 'failed',
    requested: { latitude: point.latitude, longitude: point.longitude, accuracy: 10 }, observed: null, checkedAt: null,
    googleAcknowledged: false, preparedMapView: null, submissionAttempted: false, submitted: false, failure: null,
  };
  let stage = 'map_home';
  try {
    await page.goto(`https://www.google.com/maps/@${point.latitude},${point.longitude},${point.zoom}z?hl=${encodeURIComponent(locale.split('-')[0] ?? 'en')}`, { waitUntil: 'domcontentloaded', timeout: remaining() });
    const initial = await detectPageState(page);
    if (initial.kind === 'captcha' || initial.kind === 'consent') {
      evidence.failure = initial.kind;
      return { state: initial, finalUrl: page.url(), searchLocation: evidence };
    }
    if (new URL(page.url()).origin !== 'https://www.google.com') throw new Error('unexpected location origin');
    stage = 'gps_readback';
    const observed = await page.evaluate(ms => new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('browser geolocation timeout')), ms);
      navigator.geolocation.getCurrentPosition(p => { clearTimeout(timer); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }); }, e => { clearTimeout(timer); reject(new Error(`browser geolocation error ${e.code}`)); }, { timeout: ms, maximumAge: 0, enableHighAccuracy: true });
    }), Math.min(5000, remaining()));
    evidence.observed = observed; evidence.checkedAt = new Date().toISOString();
    if (![observed.latitude, observed.longitude, observed.accuracy].every(Number.isFinite) || observed.accuracy < 0 || observed.accuracy > 50 || Math.abs(observed.latitude - point.latitude) > 0.00001 || Math.abs(observed.longitude - point.longitude) > 0.00001) throw new Error('browser position differs from requested point');
    stage = 'google_location_ack';
    const acknowledged = page.getByRole('button', { name: 'Your Location', exact: true });
    // Maps normally reads permitted GPS on home-page load. Require that acknowledgement;
    // do not submit a query while merely waiting for, or displaying, a URL camera anchor.
    await acknowledged.waitFor({ state: 'visible', timeout: remaining() });
    if (await acknowledged.count() !== 1) throw new Error('ambiguous location acknowledgement');
    evidence.googleAcknowledged = true;
    stage = 'camera_check';
    const camera = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/.exec(new URL(page.url()).pathname);
    if (!camera) throw new Error('prepared camera unavailable');
    evidence.preparedMapView = { latitude: Number(camera[1]), longitude: Number(camera[2]), zoom: Number(camera[3]) };
    if (Math.abs(evidence.preparedMapView.latitude - point.latitude) > 0.0001 || Math.abs(evidence.preparedMapView.longitude - point.longitude) > 0.0001 || evidence.preparedMapView.zoom !== point.zoom) throw new Error('prepared camera differs from requested point');
    stage = 'search_submission';
    const input = page.locator('input[name="q"]:visible');
    if (await input.count() !== 1 || await input.inputValue({ timeout: remaining() }) !== '') throw new Error('search home is not an empty unique input');
    await input.fill(keyword, { timeout: remaining() });
    if (await input.inputValue({ timeout: remaining() }) !== keyword) throw new Error('search input mismatch');
    const submit = page.getByRole('button', { name: 'Search', exact: true });
    if (await submit.count() !== 1) throw new Error('ambiguous search submit');
    const clickBudget = remaining();
    evidence.status = 'prepared'; evidence.submissionAttempted = true;
    await submit.click({ timeout: clickBudget });
    evidence.submitted = true;
    stage = 'search_result_wait';
    let state = await detectPageState(page);
    while (state.kind === 'unknown') {
      await page.waitForTimeout(Math.min(250, remaining()));
      state = await detectPageState(page);
    }
    return { state, finalUrl: page.url(), searchLocation: evidence };
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
    throw new SearchLocationError(evidence.failure, evidence);
  }
}
