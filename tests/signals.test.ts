import { describe, expect, it } from 'vitest';
import { createSignalHandler } from '../src/runner/signals.js';

describe('createSignalHandler', () => {
  it('aborts once and ignores repeated signals instead of dying', () => {
    const controller = new AbortController();
    const notes: string[] = [];
    const handler = createSignalHandler(controller, (m) => notes.push(m));
    handler('SIGINT');
    handler('SIGINT');
    handler('SIGTERM');
    expect(controller.signal.aborted).toBe(true);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/SIGINT received/);
    expect(notes[1]).toMatch(/already stopping/);
    expect(notes[2]).toMatch(/already stopping/);
  });
});
