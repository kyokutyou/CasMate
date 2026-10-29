import type { DirectFamily, DirectTcpEndpoint } from '../../shared/direct-connection';

export interface EndpointDraft { key: string; id: string; family: DirectFamily; address: string; port: string; }
export function emptyEndpoint(): EndpointDraft {
  const id = crypto.randomUUID();
  return { key: id, id, family: 'ipv4', address: '', port: '' };
}
export function endpointValues(rows: EndpointDraft[], saved: DirectTcpEndpoint[]): DirectTcpEndpoint[] {
  return rows.filter(row => row.address.trim() || row.port).map(row => {
    const address = row.address.trim(); const tcpPort = Number(row.port);
    if (!/^\d+$/u.test(row.port)) throw new Error('公開ポートは1024～65535の整数で入力してください。');
    return { id: saved.find(value => value.family === row.family && value.address === address && value.tcpPort === tcpPort)?.id ?? row.id,
      family: row.family, address, tcpPort };
  });
}
