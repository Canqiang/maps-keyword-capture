import { describe, it, expect } from 'vitest';
import { closeWithin } from '../src/runner/batch-runner.js';
describe('browser cleanup confirmation', () => {
  it('distinguishes successful cleanup, rejected cleanup and timeout', async () => {
    expect(await closeWithin({ close: async () => {} }, 20)).toBe('closed');
    expect(await closeWithin({ close: async () => { throw new Error('close failed'); } }, 20)).toBe('failed');
    expect(await closeWithin({ close: () => new Promise<void>(() => {}) }, 1)).toBe('timed_out');
  });
});
