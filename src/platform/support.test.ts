import { describe, expect, it } from 'vitest';
import { detectSupport, isFullySupported } from './support';

describe('detectSupport', () => {
  it('rozpozná Edge/Chrome s File System Access API', () => {
    const chromium = { showDirectoryPicker: () => undefined, indexedDB: {}, Worker: class {} };
    expect(isFullySupported(detectSupport(chromium))).toBe(true);
  });

  it('rozpozná prohlížeč bez čtení složek', () => {
    const firefox = { indexedDB: {}, Worker: class {} };
    const support = detectSupport(firefox);
    expect(support.directoryAccess).toBe(false);
    expect(isFullySupported(support)).toBe(false);
  });
});
