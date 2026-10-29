import { useEffect, useState } from 'react';
import type { DirectAdapterOption } from '../../shared/direct-connection';

interface Props {
  visible: boolean; busy: boolean; interfaceId: string | null;
  list?: () => Promise<DirectAdapterOption[]>;
  select: (id: string | null) => void;
}
function directAdapterLabel(adapter: DirectAdapterOption): string {
  const address = adapter.addresses.find(a => a.family === 'ipv4') ?? adapter.addresses[0];
  return `${adapter.name}${address ? `（${address.address}）` : ''}${adapter.description ? ` ${adapter.description}` : ''}`;
}
export function DirectAdapterSelect({ visible, busy, interfaceId, list, select }: Props) {
  const [adapters, setAdapters] = useState<DirectAdapterOption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState('loading');
    void (list ? list() : Promise.reject(new Error('Unavailable'))).then(values => {
      if (cancelled) return;
      setAdapters(values); setState('ready');
    }, () => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [visible, list, refresh]);
  const selected = adapters.find(a => a.id.toLowerCase() === interfaceId?.toLowerCase());
  const missing = Boolean(interfaceId && !selected);
  const savedLabel = state === 'ready' ? '保存済みの接続先（現在利用できません）' : '保存済みの接続先';
  return <div className="sp-adapter">
    <label className="sp-field">PCの接続先ネットワーク
      <select aria-label="PCの接続先ネットワーク" value={selected?.id ?? interfaceId ?? ''} disabled={busy || state !== 'ready'} onChange={event => select(event.currentTarget.value || null)}>
        <option value="">Windowsの既定の接続先を選ぶ</option>
        {missing && <option value={interfaceId!} disabled>{savedLabel}</option>}
        {adapters.map(adapter => <option key={adapter.id} value={adapter.id}>{directAdapterLabel(adapter)}</option>)}
      </select>
      <small className="sp-adapter-label">{selected ? directAdapterLabel(selected) : interfaceId ? savedLabel : 'Windowsの既定の接続先を選ぶ'}</small>
      <small>既定の接続先は受信準備時に選び、保存します。保存した接続先が消えた場合は自動で別のものへ切り替えません。</small>
    </label>
    <div className="sp-adapter-status" role="status">{state === 'loading' ? 'ネットワーク一覧を取得中です。' : state === 'error' ? 'ネットワーク一覧を取得できません。一覧を更新してください。' : missing ? '保存した接続先を利用できません。接続状態を確認するか、選択し直してください。' : adapters.length ? '利用可能なネットワークから選択できます。' : '利用可能なネットワークがありません。PCの接続状態を確認してください。'}</div>
    <button className="secondary" disabled={state === 'loading'} onClick={() => setRefresh(value => value + 1)}>一覧を更新</button>
  </div>;
}
