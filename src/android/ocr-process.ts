import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ScreenOcr, ScreenRecognizer } from './screen-reader.js';

const stages = ['request', 'version', 'languages', 'full_screen', 'rating_psm7', 'rating_psm13', 'engine'] as const;
type Stage = typeof stages[number];
export interface OcrStageEvent {
  stage: Stage; event: 'start' | 'end'; durationMs?: number; exitCode?: number | null;
  timedOut?: boolean; errorClass?: string;
}
export interface OcrProcessReport {
  schemaVersion: 'android-ocr-process/v1'; imageSha256: string; startedAt: string;
  durationMs: number; timeoutMs: number; threadLimit: 1;
  outcome: 'ok' | 'failed'; failureReason: string | null; exitCode: number | null;
  signal: string | null; timedOut: boolean; cancelled: boolean;
  stderrBytes: number; stderrSha256: string; stages: OcrStageEvent[]; lastStage: Stage | null;
}
const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
// Engine messages may include arbitrary paths/content. Retain only typed events
// and a byte count/hash of stderr; never serialize raw subprocess errors or env.
function stageEvents(stderr: string): OcrStageEvent[] {
  const result: OcrStageEvent[] = [];
  for (const line of stderr.split('\n').slice(-128)) {
    let x; try { x = JSON.parse(line); } catch { continue; }
    if (!x || x.schemaVersion !== 'android-ocr-stage/v1' || !stages.includes(x.stage) || !['start', 'end'].includes(x.event)) continue;
    const item: OcrStageEvent = { stage: x.stage, event: x.event };
    if (typeof x.durationMs === 'number' && Number.isFinite(x.durationMs) && x.durationMs >= 0) item.durationMs = x.durationMs;
    if (x.exitCode === null || Number.isSafeInteger(x.exitCode)) item.exitCode = x.exitCode;
    if (typeof x.timedOut === 'boolean') item.timedOut = x.timedOut;
    if (['TimeoutExpired', 'TimeoutError', 'CalledProcessError', 'ValueError', 'OSError', 'Error'].includes(x.errorClass)) item.errorClass = x.errorClass;
    result.push(item);
  }
  return result.slice(-64);
}

/** One local OCR attempt. No retry, rescreenshot or search side effect. */
export const recognizeScreenProcess: ScreenRecognizer = request => new Promise((resolve, reject) => {
  const startedAt = new Date().toISOString(), began = performance.now();
  let timedOut = false, cancelled = request.signal?.aborted ?? false, outputLimit = false, spawnFailed = false;
  let size = 0; const output: Buffer[] = [], errors: Buffer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => { cancelled = true; terminate(); };
  const child = spawn('python3', [fileURLToPath(new URL('../../deploy/android/linux/screen_ocr.py', import.meta.url))], {
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
  });
  function terminate(): void {
    try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
  }
  function collect(chunks: Buffer[], data: Buffer): void {
    size += data.length;
    if (size > 16 * 1024 * 1024) { outputLimit = true; terminate(); return; }
    chunks.push(data);
  }
  child.stdout.on('data', (data: Buffer) => collect(output, data));
  child.stderr.on('data', (data: Buffer) => collect(errors, data));
  const finishPrimary = (): void => {
    clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort);
    // exit precedes close: descendants can otherwise keep inherited pipes open.
    // This process group belongs only to this OCR attempt, including on success.
    terminate();
  };
  child.on('exit', finishPrimary);
  child.on('error', () => { spawnFailed = true; finishPrimary(); });
  child.on('close', (exitCode, signal) => {
    clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort);
    terminate();
    const stderr = Buffer.concat(errors), events = stageEvents(stderr.toString('utf8'));
    // Optional crop failures can recover. Only the terminal failure explains
    // the primary process exit; earlier timeout events remain diagnostic detail.
    const terminalEvent = events.at(-1);
    const engineTimeout = exitCode !== null && exitCode !== 0 && signal === null
      && terminalEvent?.stage === 'request' && terminalEvent.event === 'end' && terminalEvent.timedOut === true;
    let value: ScreenOcr | undefined;
    let failureReason: string | null = cancelled ? 'cancelled' : timedOut || engineTimeout ? 'timeout' : outputLimit ? 'output_limit' : spawnFailed ? 'spawn_error' : exitCode !== 0 ? 'process_exit' : null;
    if (!failureReason) { try { value = JSON.parse(Buffer.concat(output).toString('utf8')) as ScreenOcr; } catch { failureReason = 'invalid_json'; } }
    const report: OcrProcessReport = {
      schemaVersion: 'android-ocr-process/v1', imageSha256: sha(request.png), startedAt,
      durationMs: Math.round(performance.now() - began), timeoutMs: request.timeoutMs, threadLimit: 1,
      outcome: failureReason ? 'failed' : 'ok', failureReason, exitCode, signal,
      timedOut: timedOut || engineTimeout, cancelled,
      stderrBytes: stderr.length, stderrSha256: sha(stderr), stages: events, lastStage: terminalEvent?.stage ?? null,
    };
    void (async () => {
      await request.onDiagnostics?.(report);
      if (failureReason) throw Object.assign(new Error('OCR process failed; inspect immutable OCR process diagnostics'), { code: failureReason === 'cancelled' ? 'CANCELLED' : 'OCR_PROCESS_FAILED' });
      resolve(value!);
    })().catch(reject);
  });
  timer = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
  request.signal?.addEventListener('abort', onAbort, { once: true });
  if (request.signal?.aborted) onAbort();
  child.stdin.on('error', () => { /* Process close determines outcome and persists diagnostics. */ });
  child.stdin.end(JSON.stringify({ pngBase64: request.png.toString('base64'), timeoutMs: request.timeoutMs,
    deadlineEpochMs: Date.now() + request.timeoutMs - 500, languages: request.languages, scale: request.scale ?? 2 }));
});
