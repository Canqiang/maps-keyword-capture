import { describe, expect, it } from 'vitest';
import { UI_HTML } from '../src/web/ui.js';

describe('scan interruption banner', () => {
  it('renders a global banner backed by the scan health endpoint', () => {
    expect(UI_HTML).toContain('id="scan-alert"');
    expect(UI_HTML).toContain('/api/scans/health');
    expect(UI_HTML).toContain('采集可能已中断');
    expect(UI_HTML).toContain('scan-alert-open');
    // The health check must run on every route, not only when the manual scan panel is opened.
    expect(UI_HTML).toContain('void loadScanAlert();');
  });
});
