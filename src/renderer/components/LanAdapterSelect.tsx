import { useEffect, useState } from 'react';
import type { DirectAdapterOption } from '../../shared/direct-connection';
import { CompactFeedback } from './CompactFeedback';

interface Props {
  visible: boolean; busy: boolean; retryable: boolean; interfaceId?: string | null;
  list?: () => Promise<DirectAdapterOption[]>;
  select(id: string): Promise<unknown>;
}
export function LanAdapterSelect({ visible, busy, retryable, interfaceId, list, select }: Props) {
  const [adapters, setAdapters] = useState<DirectAdapterOption[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false; setState('loading');
    void (list ? list() : Promise.reject()).then(values => {
      if (!cancelled) { setAdapters(values); setState('ready'); }
    }, () => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [visible, list, refresh]);
  const value = interfaceId ?? '';
  const selected = adapters.find(a => a.id.toLowerCase() === value.toLowerCase());
  const label = (a: DirectAdapterOption) => a.name + '（' + a.addresses.map(v => v.address).join(' / ') + '）' + (a.description ? ' ' + a.description : '');
  return <div className="sp-adapter sp-lan-adapter">
    <label className="sp-field">スマホとつながるPCのLANアダプター
      <select aria-label="スマホとつながるPCのLANアダプター" value={selected?.id ?? value} disabled={busy || state !== 'ready'} onChange={event => { const id = event.currentTarget.value; if (id) void select(id); }}>
        <option value="" disabled>スマホのWi-Fi・LAN側を選択してください</option>
        {value && !selected && <option value={value}>保存済みの接続先（現在利用できません）</option>}
        {adapters.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
      </select>
      <small className="sp-adapter-label">{selected ? label(selected) : 'スマホと同じWi-FiにつながるPC側の接続を選んでください。'}</small>
    </label>
    <CompactFeedback role="status" reserve={['一覧を取得中です。', '一覧を取得できません。「LAN一覧を更新」を押してください。', '接続先が見つかりません。LAN接続を確認してください。', '保存できませんでした。「保存を再試行」を押してください。', '選択すると自動保存されます。']}>
      {state === 'loading' ? '一覧を取得中です。' : state === 'error' ? '一覧を取得できません。「LAN一覧を更新」を押してください。' : value && !selected ? '接続先が見つかりません。LAN接続を確認してください。' : retryable ? '保存できませんでした。「保存を再試行」を押してください。' : '選択すると自動保存されます。'}
    </CompactFeedback>
    <div className="button-row"><button type="button" className="secondary" disabled={busy || state === 'loading'} onClick={() => setRefresh(n => n + 1)}>LAN一覧を更新</button>
    <button type="button" className="secondary" disabled={!retryable || busy || state !== 'ready' || !selected} onClick={() => { if (retryable && !busy && state === 'ready' && selected) void select(selected.id); }}>保存を再試行</button></div>
  </div>;
}
