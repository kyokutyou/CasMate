import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultDirectSettings, directHost, validateDirectSettings, type DirectSettings, type DirectTcpEndpoint, type DirectEntryView, type DirectFamily } from '../../shared/direct-connection';
import type { SmartphoneConfiguration, SmartphoneNetwork, SmartphoneView } from '../../shared/smartphone';
import { DirectAdapterSelect } from './DirectAdapterSelect';
import { DirectEndpointEditor } from './DirectEndpointEditor';
import { ConnectionRouteIcon } from './ConnectionRouteIcon';
import { endpointValues, type EndpointDraft } from './direct-endpoint-draft';
import './direct-settings-panel.css';

interface Props {
  initialSetup?: boolean; visible: boolean; network: SmartphoneNetwork; portEditor: ReactNode; blocked: boolean;
  listAdapters?: () => Promise<import('../../shared/direct-connection').DirectAdapterOption[]>;
  view: SmartphoneView; busy: boolean; configure: (value: SmartphoneConfiguration) => Promise<unknown>;
  run: (action: () => Promise<unknown>, success?: string) => Promise<unknown>;
  action?: (action: 'retry' | 'cleanup' | 'manual-confirm' | 'reset-key', body?: unknown) => Promise<unknown>;
  defer: (key: string, action: (() => Promise<unknown>) | null | undefined) => void;
}
const routes = [{ id: 'phone', label: '外出先のスマホ', platform: 'ANDROID', help: '実際の接続を確認' },
  { id: 'router', label: '自宅のルーター', platform: 'INTERNET', help: '公開する入口を設定' },
  { id: 'pc', label: 'このPCの受信', platform: 'WINDOWS PC', help: '内部ポートと受信準備' }] as const;
type Route = typeof routes[number]['id'];
const methods = { upnp: 'UPnP', pcp: 'PCP', manual: '手動', unnecessary: '開放不要' };
function connectionState(entry: DirectEntryView) {
  return { connected: '確認済み', unconfirmed: '未確認', disconnected: '切断・確認失効' }[entry.reachability];
}
function DirectWarning({ warning }: { warning: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState(warning);
  return <details className="sp-direct-resource-warning" open={expanded}>
    <summary onClick={event => {
      event.preventDefault();
      if (!expanded) setContent(warning);
      setExpanded(!expanded);
    }}>要確認の内容<small data-warning={Boolean(warning)}>{warning ? 'あり' : 'なし'}</small></summary>
    <small>開いた時点の内容です。最新の内容は、閉じて開き直すと確認できます。</small>
    <p>{content || 'この通信の要確認事項はありません。'}</p>
  </details>;
}
function DirectStatus({ view, connection = false, initialSetup = false }: { view: SmartphoneView; connection?: boolean; initialSetup?: boolean }) {
  const active = view.settings.activeNetwork === 'direct';
  return <div className="sp-direct-resources" role="group" aria-label={connection ? '通信ごとの実接続' : '通信ごとの受信準備'}>
    {!view.direct?.entries.length && <p>{active ? '受信準備の結果はまだありません。' : '直接接続はOFF'}</p>}
    {view.direct?.entries.map(entry => <article key={entry.id} className="sp-direct-resource" data-family={entry.family}>
      <div className="sp-direct-resource-heading"><span className="sp-direct-protocol">{entry.protocol.toUpperCase()}</span><strong>{entry.deviceId ? `${view.devices.find(d => d.id === entry.deviceId)?.name ?? '削除したスマホ'}の映像・配信マイク` : initialSetup ? '登録・コメント' : '登録・コメント・OBS操作'}</strong><small>{entry.family === 'ipv6' ? 'IPv6' : 'IPv4'}</small></div>
      <code className="sp-direct-resource-address">公開 {entry.address && entry.publicPort ? directHost(entry.address, entry.publicPort) : '未確認'}</code>
      {connection ? <span className="sp-direct-result" data-tone={active && entry.reachability === 'connected' ? 'ready' : 'warning'}><ConnectionRouteIcon name={active && entry.reachability === 'connected' ? 'check' : 'signal'} size={17}/>{active ? connectionState(entry) : '直接接続はOFF'}</span>
        : <><code className="sp-direct-resource-address">PC内部 {directHost(entry.localAddress, entry.localPort)}</code>
          <dl className="sp-direct-checks"><div><dt>PCの受信準備</dt><dd data-tone={active && entry.listener ? 'ready' : 'idle'}>{!active ? 'OFF' : entry.listener ? '準備済み' : '未完了'}</dd></div>
            <div><dt>Windows許可</dt><dd data-tone={active && entry.firewall ? 'ready' : 'idle'}>{!active ? 'OFF' : entry.firewall ? '準備済み' : '未完了'}</dd></div>
            <div><dt>公開準備</dt><dd data-tone={active && entry.prepared ? 'ready' : 'idle'}>{!active ? 'OFF' : entry.prepared ? '準備済み' : '未完了'}</dd></div></dl>
          <small className="sp-direct-resource-expiry">方式 {methods[entry.method]} ／ 期限 {entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : '期限なし／未取得'}</small></>}
      <DirectWarning warning={entry.warning}/>
    </article>)}
  </div>;
}
export function DirectSettingsPanel({ initialSetup = false, view, busy, blocked, network, portEditor, configure, run, action, defer, visible, listAdapters }: Props) {
  const settings = view.settings.direct ?? defaultDirectSettings();
  const [route, setRoute] = useState<Route>('router'); const [deviceId, setDeviceId] = useState(view.devices[0]?.id ?? '');
  const selectedDevice = view.devices.find(device => device.id === deviceId) ?? view.devices[0];
  const [tcp, setTcp] = useState<EndpointDraft[]>(); const [udp, setUdp] = useState<Record<string, EndpointDraft[]>>({});
  const [message, setMessage] = useState('');
  const latest = useRef(view); useEffect(() => { latest.current = view; }, [view]);
  const draft = useRef<{ tcp?: EndpointDraft[]; udp: Record<string, EndpointDraft[]> }>({ udp: {} });
  const revision = useRef(0);
  const [identities, setIdentities] = useState({ keys: new Map<string, string>(), layouts: new Map<string, EndpointDraft[]>(), blanks: new Map<string, EndpointDraft>() });
  function rows(group: string, values: DirectTcpEndpoint[]): EndpointDraft[] {
    const savedRows = values.map(value => ({ key: identities.keys.get(value.id) ?? value.id, id: value.id,
      family: value.family, address: value.address, port: String(value.tcpPort) }));
    const layout = identities.layouts.get(group);
    if (layout) {
      const matched = new Set<string>();
      const slots = layout.map(row => {
        const saved = savedRows.find(value => value.key === row.key);
        if (saved) { matched.add(saved.id); return saved; }
        return { ...row, id: '', address: '', port: '' };
      });
      const remaining = savedRows.filter(row => !matched.has(row.id));
      const ordered = slots.map(row => {
        const saved = !row.address && !row.port ? remaining.shift() : undefined;
        return saved ? { ...saved, key: row.key } : row;
      });
      ordered.push(...remaining);
      if (ordered.length) return ordered;
    }
    if (savedRows.length) return savedRows;
    const blank = identities.blanks.get(group) ?? { key: `empty:${group}`, id: '', family: 'ipv4' as const, address: '', port: '' };
    return [blank];
  }
  const build = useCallback((): DirectSettings => {
    const current = latest.current; const saved = current.settings.direct ?? defaultDirectSettings(); const values = draft.current;
    return validateDirectSettings({ ...saved,
      manualEndpoints: values.tcp === undefined ? saved.manualEndpoints : endpointValues(values.tcp, saved.manualEndpoints),
      manualSrtEndpoints: current.devices.flatMap(d => {
        const savedUdp = saved.manualSrtEndpoints.filter(e => e.deviceId === d.id);
        return values.udp[d.id] === undefined ? savedUdp : endpointValues(values.udp[d.id], savedUdp.map(e => ({ ...e, tcpPort: e.outdoorPort })))
          .map(e => ({ id: e.id, family: e.family, address: e.address, outdoorPort: e.tcpPort, deviceId: d.id }));
      }),
    });
  }, []);
  const edit = useCallback((change: Partial<typeof draft.current>) => {
    draft.current = { ...draft.current, ...change }; const current = ++revision.current;
    try { build(); setMessage('入力から500ms後に保存します。'); }
    catch (error) { setMessage(`${error instanceof Error ? error.message : '設定を確認してください。'} 未保存です。`); defer('direct', null); return; }
    defer('direct', async () => {
      if (revision.current !== current) return;
      try {
        const { manualEndpoints, manualSrtEndpoints } = build();
        // Keep DOM identity when saving a new candidate ID or clearing the final row.
        const values = draft.current;
        setIdentities(previous => {
          const retainedIds = new Set([...manualEndpoints, ...manualSrtEndpoints].map(endpoint => endpoint.id));
          const next = { keys: new Map([...previous.keys].filter(([id]) => retainedIds.has(id))), layouts: new Map(previous.layouts), blanks: new Map(previous.blanks) };
          const remember = (group: string, groupRows: EndpointDraft[] | undefined, endpoints: DirectTcpEndpoint[]) => {
            for (const row of groupRows ?? []) {
              const endpoint = endpoints.find(value => value.family === row.family && value.address === row.address.trim() && value.tcpPort === Number(row.port));
              if (endpoint) next.keys.set(endpoint.id, row.key);
            }
            if (groupRows) next.layouts.set(group, groupRows);
            if (!endpoints.length && groupRows?.length) next.blanks.set(group, { ...groupRows[0], address: '', port: '' });
          };
          remember('tcp', values.tcp, manualEndpoints);
          for (const [id, groupRows] of Object.entries(values.udp)) remember(id, groupRows, manualSrtEndpoints.filter(e => e.deviceId === id).map(e => ({ ...e, tcpPort: e.outdoorPort })));
          return next;
        });
        await configure({ network: 'direct', direct: { manualEndpoints, manualSrtEndpoints } });
      }
      catch (error) { setMessage('設定を保存できません。入力を確認して再編集してください。'); throw error; }
      if (revision.current === current) { draft.current = { udp: {} }; setTcp(undefined); setUdp({}); setMessage(''); }
    });
  }, [build, configure, defer]);
  useEffect(() => {
    const ids = new Set(view.devices.map(device => device.id));
    const retained = Object.fromEntries(Object.entries(draft.current.udp).filter(([id]) => ids.has(id)));
    if (Object.keys(retained).length === Object.keys(draft.current.udp).length) return;
    draft.current = { ...draft.current, udp: retained }; setUdp(retained);
    if (draft.current.tcp !== undefined || Object.keys(retained).length) edit({ udp: retained });
    else { revision.current += 1; setMessage(''); defer('direct', undefined); }
  }, [view.devices, defer, edit]);
  const direct = network === 'direct'; const active = view.settings.activeNetwork === 'direct';
  const hasDraft = tcp !== undefined || Object.keys(udp).length > 0;
  const operationsBlocked = busy || blocked || hasDraft;
  const destination = (protocol: 'tcp' | 'udp', family: DirectFamily, address: string, id?: string) => {
    const entries = view.direct?.entries.filter(entry => entry.protocol === protocol && entry.deviceId === id && entry.family === family &&
      (family === 'ipv4' || entry.localAddress === address)) ?? [];
    return entries.length ? [...new Set(entries.map(entry => directHost(entry.localAddress, entry.localPort)))].join(' ／ ')
      : protocol === 'tcp' ? `PCの${family === 'ipv4' ? 'IPv4' : 'IPv6'}・受信ポート ${view.settings.statusPorts.direct}（IPは受信準備後に表示）` : '端末の受信準備後に表示します';
  };
  const entries = view.direct?.entries ?? [];
  const listening = entries.filter(entry => entry.listener).length;
  const preparationState = (values: DirectEntryView[]) => !active ? '直接接続はOFF' : !values.length ? '公開接続先は未取得'
    : values.every(entry => entry.prepared) ? `公開準備済み ${values.length}件` : '準備中・要確認';
  return <section className="sp-section sp-direct-settings" aria-label="接続の詳細">
    <div hidden={!direct}>
      <p className="sp-direct-intro">接続経路の各場所を選んで、設定と状態を確認できます。ONの間は入口を維持し、PC再起動時も再準備します。</p>
      <div className="sp-direct-route" role="tablist" aria-label="直接接続の経路">{routes.map((item, index) => <button type="button" role="tab" key={item.id}
        id={`sp-direct-tab-${item.id}`} aria-controls={`sp-direct-pane-${item.id}`} aria-selected={route === item.id} tabIndex={route === item.id ? 0 : -1}
        onClick={() => setRoute(item.id)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
          if (next === null) return; event.preventDefault(); setRoute(routes[next].id); document.getElementById(`sp-direct-tab-${routes[next].id}`)?.focus();
        }}><span className="sp-direct-node-heading"><span className="sp-direct-node-icon"><ConnectionRouteIcon name={item.id} size={30}/></span><ConnectionRouteIcon name="check" size={17}/></span>
        <span className="sp-direct-node-platform">{item.platform}</span><strong>{item.label}</strong><small>{item.help}</small>
        <span className="sp-direct-node-state">{!active ? 'OFF・設定を編集' : item.id === 'phone' ? `コメント ${entries.filter(e => e.protocol === 'tcp' && e.reachability === 'connected').length}件・映像 ${entries.filter(e => e.protocol === 'udp' && e.reachability === 'connected').length}件を確認` : item.id === 'pc' ? `PCの受信準備 ${listening}/${entries.length}件` : settings.mode === 'auto' ? '自動で入口を準備' : 'ルーターで手動設定'}</span>
        {index < 2 && <span className="sp-direct-route-arrow"><ConnectionRouteIcon name="arrow" size={19}/></span>}
      </button>)}</div>
    </div>
    <div id="sp-direct-pane-router" role="tabpanel" aria-labelledby="sp-direct-tab-router" hidden={!direct || route !== 'router'}>
      <div className="sp-direct-panel-heading"><h3>ルーターの入口と転送先</h3><p>外出先から入る公開ポートを、このPCの受信先へつなぎます。</p></div>
      <div className="sp-direct-modes" role="group" aria-label="直接接続の開放方法">{(['auto', 'manual'] as const).map(mode => <button type="button" key={mode} aria-pressed={settings.mode === mode} disabled={busy}
        onClick={() => { if (settings.mode !== mode) void run(() => configure({ network: 'direct', direct: { mode } }), '開放方法を保存しました。'); }}>
        <span className="sp-direct-mode-heading"><ConnectionRouteIcon name={mode === 'auto' ? 'automatic' : 'manual'}/><strong>{mode === 'auto' ? '自動で開放' : 'ルーターで手動設定'}</strong><span className="sp-direct-mode-check"><ConnectionRouteIcon name="check" size={17}/></span></span><small>{mode === 'auto' ? '対応ルーターで入口を準備' : '公開IPとポートを指定'}</small></button>)}</div>
      <div hidden={settings.mode !== 'auto'} className="sp-direct-auto">
        <div className="sp-direct-auto-note"><ConnectionRouteIcon name="automatic"/><p>公開接続先と有効期限を自動で取得・更新します。自動開放が使えない場合は、ルーターで手動設定してください。</p></div>
        <dl className="sp-direct-auto-states">{(['ipv4', 'ipv6'] as const).map(family => <div key={family}><dt>{family === 'ipv4' ? 'IPv4の入口' : 'IPv6の入口'}</dt><dd>{preparationState(entries.filter(entry => entry.family === family))}</dd></div>)}
          <div><dt>開放方式・有効期限</dt><dd>通信ごとの結果を「このPCの受信」で確認</dd></div></dl>
        <p className="sp-direct-footnote">{initialSetup ? 'スマホの送信停止では入口を閉じません。' : 'スマホの送信停止・OBS配信終了では入口を閉じません。'}閉じるときは直接接続をOFFにします。</p></div>
      <div hidden={settings.mode !== 'manual'} className="sp-direct-manual">
        <h4>公開接続先と転送先</h4><p className="sp-note">IPv4は公開ポートからPC内部へ転送します。IPv6は、このPCのIPv6アドレスと受信ポートへの通信をルーターで許可します。</p>
        <DirectEndpointEditor label="共通TCP" protocol="TCP" description={initialSetup ? '登録・コメント' : '登録・コメント・OBS操作'} rows={tcp ?? rows('tcp', settings.manualEndpoints)} destination={(family, address) => destination('tcp', family, address)} busy={busy} change={values => { setTcp(values); edit({ tcp: values }); }} />
        <div className="sp-direct-confirm">{action && <button className="secondary sp-direct-icon-button" disabled={operationsBlocked || !active || !settings.manualEndpoints.length} onClick={() => void run(() => action('manual-confirm', { revision: view.direct?.revision }), '共通TCPの手動設定を確認しました。')}><ConnectionRouteIcon name="shield" size={17}/>共通TCPの手動開放を確認</button>}<span>{preparationState(entries.filter(entry => entry.protocol === 'tcp'))}</span></div>
        <div className="sp-direct-device">
          <label className="sp-field">映像の設定対象<select aria-label="公開UDPを設定するスマホ" value={selectedDevice?.id ?? ''} disabled={!view.devices.length} onChange={event => setDeviceId(event.target.value)}>
            {!view.devices.length && <option value="">登録したスマホがありません</option>}{view.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
          </select></label>
          {!view.devices.length && <p>共通QRでスマホを登録すると、端末のUDP接続先を設定できます。</p>}
          {view.devices.map(device => <div key={device.id} hidden={device.id !== selectedDevice?.id}>
            <DirectEndpointEditor label={`${device.name}のUDP`} protocol="UDP" description={`${device.name}・映像・配信マイク`} rows={udp[device.id] ?? rows(device.id, settings.manualSrtEndpoints.filter(e => e.deviceId === device.id).map(e => ({ ...e, tcpPort: e.outdoorPort })))}
              destination={(family, address) => destination('udp', family, address, device.id)} busy={busy} change={values => { const next = { ...draft.current.udp, [device.id]: values }; setUdp(next); edit({ udp: next }); }} />
            <div className="sp-direct-confirm">{action && <button className="secondary sp-direct-icon-button" disabled={operationsBlocked || !active || !settings.manualSrtEndpoints.some(e => e.deviceId === device.id)} onClick={() => void run(() => action('manual-confirm', { revision: view.direct?.revision, deviceId: device.id }), `${device.name}のUDP手動設定を確認しました。`)}><ConnectionRouteIcon name="shield" size={17}/>{device.name}のUDP手動開放を確認</button>}<span>{preparationState(entries.filter(entry => entry.deviceId === device.id))}</span></div>
          </div>)}
          <p className="sp-note">{initialSetup ? 'PC内部のループバックUDPポートへは転送しません。' : 'OBS用のループバックUDPポートへは転送しません。'}</p>
        </div>
        <div className="sp-status sp-direct-save" role="status">{message || '公開IPは数値で入力します。IPv6の角括弧は不要です。手動開放の確認だけでは、外出先からの接続は確認できません。'}</div>
        <p className="sp-direct-operation-note">{!active ? '直接接続をONにすると保存済み設定の開放を確認できます。' : operationsBlocked ? '設定の保存を完了すると、手動開放を確認できます。' : 'ルーターの転送設定を終えた通信だけ、手動開放を確認してください。'}</p>
      </div>
    </div>
    <div id="sp-direct-pane-pc" role={direct ? 'tabpanel' : undefined} aria-labelledby={direct ? 'sp-direct-tab-pc' : undefined} hidden={direct && route !== 'pc'}>
      {direct && <div className="sp-direct-panel-heading"><h3>このPCの受信先</h3><p>ルーターが転送する内部ポートと、Windows側の準備を確認します。</p></div>}
      {portEditor}
      <div hidden={!direct}>
        <DirectAdapterSelect visible={visible && direct && route === 'pc'} busy={busy} interfaceId={settings.interfaceId} list={listAdapters} select={interfaceId => {
          void run(() => configure({ network: 'direct', direct: { interfaceId } }), '接続先ネットワークを保存しました。');
        }} />
        <h3>通信ごとの受信準備</h3><p>PCの受信準備・Windows許可・公開準備をそれぞれ確認します。</p><DirectStatus initialSetup={initialSetup} view={view} />
        <div className="sp-status" role="status">{!active ? '直接接続はOFFです。上部のネットワークスイッチからONにできます。' : view.direct?.pendingDeviceIds.length ? '受信準備が未完了のスマホがあります。同じQRで再試行できます。' : '公開準備と実接続は別の状態です。外出先からの確認は「外出先のスマホ」を開いてください。'}</div>
        {action && <button className="secondary sp-direct-icon-button" disabled={operationsBlocked || !active} onClick={() => void run(() => action('retry'), '受信準備を再試行しています。')}><ConnectionRouteIcon name="refresh" size={17}/>準備を再試行</button>}
      </div>
    </div>
    <div id="sp-direct-pane-phone" role="tabpanel" aria-labelledby="sp-direct-tab-phone" hidden={!direct || route !== 'phone'}>
      <div className="sp-direct-panel-heading"><h3>外出先からの実接続</h3><p>スマホで接続を開始し、共通TCPと端末ごとのSRT UDPを確認してください。</p></div><DirectStatus initialSetup={initialSetup} view={view} connection />
      <div className="sp-status" role="status">{initialSetup ? '準備済みでも、外出先から接続するまでは未確認です。このPCの端末欄で映像・マイクの受信を確認してください。' : '準備済みでも、外出先から接続するまでは未確認です。映像・音声が表示されているかはOBSで確認してください。'}</div>
    </div>
    <div hidden={!direct}><details className="sp-direct-maintenance"><summary><ConnectionRouteIcon name="tools" size={18}/><span>保守・復旧</span><small>ルーターの開放設定・PCの識別</small></summary>
      <h4>ルーターに残った開放設定の確認・削除</h4><div className="sp-status" role="status">{view.direct?.residual.length ? view.direct.residual.map(e => <p key={`${e.id}:${e.kind}`}>{e.message}</p>) : '報告された残存設定はありません。'}<small>きゃすメイトが所有する設定だけを対象にします。手動設定はルーター側で確認してください。</small></div>
      {action && <button className="secondary sp-direct-icon-button" disabled={operationsBlocked} onClick={() => void run(() => action('cleanup'), '残存設定の削除を再試行しました。結果を確認してください。')}><ConnectionRouteIcon name="refresh" size={17}/>残存設定を確認・削除</button>}
      <h4>このPCを確認するための鍵</h4><p>再生成には直接接続をOFFにする必要があります。直接接続の全端末登録が無効になるため、各Androidで共通QRを読み直してください。</p>
      {action && <button className="secondary sp-direct-icon-button" disabled={operationsBlocked || active} onClick={() => { if (window.confirm('このPCを確認するための鍵を再生成します。\n・直接接続の全端末登録が無効になります。\n・次回ON後、すべてのAndroidで共通QRを読み直してください。\n続けますか？')) void run(() => action('reset-key'), 'PC確認鍵を再生成する準備ができました。次回ON後にQRを読み直してください。'); }}><ConnectionRouteIcon name="key" size={17}/>PC確認鍵を再生成</button>}
    </details></div>
  </section>;
}
