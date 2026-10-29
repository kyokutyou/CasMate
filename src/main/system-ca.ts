import tls from 'node:tls';

interface CertificateStore {
  getCACertificates(type: 'default' | 'system'): string[];
  setDefaultCACertificates(certificates: string[]): void;
}

export function configureSystemCa(store: CertificateStore = tls): void {
  const bundledAndExtra = store.getCACertificates('default');
  const system = store.getCACertificates('system');
  store.setDefaultCACertificates([...bundledAndExtra, ...system]);
}
