import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSaveReportFile, downloadText } from '../../src/app/platform';

describe('browser save fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('downloads the current text under the file name', () => {
    vi.useFakeTimers();
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadText('part.nc', 'G21\nM30\n');
    vi.runAllTimers();

    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toBe('part.nc');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('downloads verification reports as markdown', async () => {
    vi.useFakeTimers();
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const saved = await browserSaveReportFile('part.nc', '# Verification report');

    vi.runAllTimers();
    expect(anchor.download).toBe('part-report.md');
    expect(saved?.name).toBe('part-report.md');
    expect(saved?.text).toBe('# Verification report');
  });
});
