import { describe, expect, it, vi } from 'vitest';
import { configureSystemCa } from '../src/main/system-ca';

describe('WindowsシステムCAの設定', () => {
  it('Node同梱CAとWindowsシステムCAをTLSの既定値へ設定する', () => {
    const setDefaultCACertificates = vi.fn();

    configureSystemCa({
      getCACertificates: (type) => type === 'default' ? ['bundled-ca'] : ['system-ca'],
      setDefaultCACertificates,
    });

    expect(setDefaultCACertificates).toHaveBeenCalledWith(['bundled-ca', 'system-ca']);
  });
});
