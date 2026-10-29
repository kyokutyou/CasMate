import { useEffect, useRef } from 'react';
import { isPublicAddress, type DirectFamily } from '../../shared/direct-connection';
import { emptyEndpoint, type EndpointDraft } from './direct-endpoint-draft';
import { ConnectionRouteIcon } from './ConnectionRouteIcon';
interface Props {
  label: string; protocol: 'TCP' | 'UDP'; description: string; rows: EndpointDraft[]; destination: (family: DirectFamily, address: string) => string; busy: boolean;
  change: (rows: EndpointDraft[]) => void;
}
export function DirectEndpointEditor({ label, protocol, description, rows, destination, busy, change }: Props) {
  const root = useRef<HTMLDivElement>(null); const focus = useRef<number | null>(null);
  useEffect(() => {
    if (focus.current === null) return;
    const fields = root.current?.querySelectorAll<HTMLSelectElement>('fieldset select');
    fields?.[Math.min(focus.current, fields.length - 1)]?.focus(); focus.current = null;
  }, [rows]);
  const edit = (index: number, patch: Partial<EndpointDraft>) => change(rows.map((row, i) => i === index ? { ...row, ...patch, id: crypto.randomUUID() } : row));
  return <div ref={root} className="sp-endpoint-editor">
    <div className="sp-endpoint-list">{rows.map((row, index) => {
      const name = `${label} 候補${index + 1}`; const started = Boolean(row.address || row.port);
      return <fieldset key={row.key} className="sp-endpoint-row"><legend className="sp-direct-visually-hidden">{name}</legend>
        <div className="sp-endpoint-heading"><span className="sp-endpoint-title"><span className="sp-direct-protocol">{protocol}</span><strong>{description}</strong><small>候補{index + 1}</small></span>
          <label className="sp-endpoint-family"><span className="sp-direct-visually-hidden">IP種別</span><select aria-label={`${name}のIP種別`} value={row.family} onChange={event => edit(index, { family: event.target.value as DirectFamily })}>
            <option value="ipv4">IPv4</option><option value="ipv6">IPv6</option></select></label>
        </div>
        <div className="sp-endpoint-map"><label className="sp-endpoint-address">公開IPアドレス<input aria-label={`${name}の公開IP`} type="text" autoComplete="off" spellCheck={false} maxLength={45}
          value={row.address} aria-invalid={started && !isPublicAddress(row.family, row.address.trim())} onChange={event => edit(index, { address: event.target.value })} /></label>
        <label>公開ポート<input aria-label={`${name}の公開ポート`} type="number" min={1024} max={65535} value={row.port}
          aria-invalid={started && (!/^\d+$/u.test(row.port) || Number(row.port) < 1024 || Number(row.port) > 65535 || Number(row.port) === 4455)}
          onChange={event => edit(index, { port: event.target.value })} /></label>
        <span className="sp-endpoint-arrow"><ConnectionRouteIcon name="arrow"/></span>
        <div className="sp-direct-destination"><span className="sp-direct-destination-arrow"><ConnectionRouteIcon name="arrow" size={18}/></span><small>{row.family === 'ipv4' ? 'PC内部の転送先' : 'PCのIPv6受信先'}</small><code>{destination(row.family, row.address.trim())}</code></div></div>
        <div className="sp-endpoint-footer"><small>{row.family === 'ipv6' ? 'IPv6はルーターの受信許可を設定' : protocol === 'TCP' ? `${description}で共通` : 'このスマホのSRT受信へ転送'}</small>
        <button type="button" className="secondary sp-endpoint-remove sp-direct-icon-button" aria-label={`${name}を削除`} disabled={busy} onClick={() => {
          focus.current = index; change(rows.length === 1 ? [{ ...row, address: '', port: '', id: crypto.randomUUID() }] : rows.filter((_, i) => i !== index));
        }}><ConnectionRouteIcon name="remove" size={16}/>削除</button></div>
      </fieldset>;
    })}</div>
    <div className="sp-endpoint-add"><button type="button" className="secondary sp-direct-icon-button" disabled={busy || rows.length >= 4} onClick={() => {
      focus.current = rows.length; change([...rows, emptyEndpoint()]);
    }}><ConnectionRouteIcon name="plus" size={17}/>{label}の候補を追加</button><small>最大4件・使わない候補は空欄で構いません。</small></div>
  </div>;
}
