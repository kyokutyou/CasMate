// THROWAWAY: three compact, graph-free PC status treatments inside A5.
export const pcStyles = [
  { id: '1', name: 'テキスト行' },
  { id: '2', name: '細いステータスバー' },
  { id: '3', name: '数値を主役に' },
] as const;
export type PcStyle = typeof pcStyles[number]['id'];
export function parsePcStyle(value: string | null): PcStyle {
  return pcStyles.find(style => style.id === value)?.id ?? '3';
}
export const pcLoads = {
  normal: { name: '通常', gpu: 38, vram: 3.2, memory: 12, cpu: 2.1, appMemory: 420 },
  raised: { name: '高め', gpu: 84, vram: 6.7, memory: 24, cpu: 9.5, appMemory: 680 },
  heavy: { name: '高負荷', gpu: 97, vram: 7.8, memory: 30.6, cpu: 28, appMemory: 1200 },
} as const;
export type PcLoad = keyof typeof pcLoads;
function tone(percent: number) { return percent >= 95 ? 'high' : percent >= 80 ? 'raised' : 'normal'; }
function readings(load: PcLoad) {
  const data = pcLoads[load];
  return [
    { label: 'GPU', value: data.gpu, unit: '%', detail: 'GPU使用率', tone: tone(data.gpu) },
    { label: 'VRAM', value: data.vram, unit: '/ 8 GB', detail: 'GPUメモリ使用量', tone: tone(data.vram / 8 * 100) },
    { label: 'メモリ', value: data.memory, unit: '/ 32 GB', detail: 'PC全体の使用メモリ量', tone: tone(data.memory / 32 * 100) },
  ];
}
export function PcStatus({ style, load, open }: { style: PcStyle; load: PcLoad; open(): void }) {
  const items = readings(load);
  const highest = items.some(item => item.tone === 'high') ? 'high' : items.some(item => item.tone === 'raised') ? 'raised' : 'normal';
  return <button className={`pc-status pc-style-${style}`} onClick={open} aria-haspopup="dialog" aria-label={`PC状態の詳細を開く：${pcLoads[load].name}、${items.map(item => `${item.detail} ${item.value}${item.unit}`).join('、')}`}>
    <span className="pc-status-title"><i className={`pc-load-dot pc-tone-${highest}`} aria-hidden="true"/>PC状態<span className="pc-sr-only">{pcLoads[load].name}</span></span>
    <span className="pc-readings">{items.map(item => <span className="pc-reading" key={item.label}><span className="pc-metric-label">{item.label}</span><span className={`pc-metric-value pc-tone-${item.tone}`}><strong>{item.value}</strong><span>{item.unit}</span></span></span>)}</span>
    <span className="pc-detail-arrow" aria-hidden="true">›</span>
  </button>;
}
export function PcStatusDetails({ load, change }: { load: PcLoad; change(load: PcLoad): void }) {
  return <div className="pc-details"><p className="pc-demo-note">表示比較用の架空の数値です。実際のPC情報は取得していません。</p><section><h3>PC全体 · {pcLoads[load].name}</h3><dl>{readings(load).map(item => <div key={item.label}><dt>{item.detail}</dt><dd className={`pc-tone-${item.tone}`}>{item.value} {item.unit}</dd></div>)}</dl></section><section><h3>きゃすメイト</h3><dl><div><dt>CPU使用率</dt><dd>{pcLoads[load].cpu} <span>%</span></dd></div><div><dt>使用メモリ量</dt><dd>{pcLoads[load].appMemory} <span>MB</span></dd></div></dl><p>アプリ本体と関連プロセスの合計を想定した表示例です。</p></section><div className="pc-demo-controls"><label className="field">試作で表示する負荷<select value={load} onChange={e => { const next = e.target.value; if (next === 'normal' || next === 'raised' || next === 'heavy') change(next); }}><option value="normal">通常</option><option value="raised">高め</option><option value="heavy">高負荷</option></select></label><p>試作の色分け：使用率80%未満は緑、80%以上は橙、95%以上は赤。VRAM・メモリは総容量に対する割合です。実機での異常判定ではありません。</p></div></div>;
}
export function PcStylePicker({ style, change }: { style: PcStyle; change(style: PcStyle): void }) {
  return <div className="pc-style-picker"><div role="group" aria-label="PC状態の見本"><span>PC表示</span>{pcStyles.map(item => <button key={item.id} aria-label={`PC表示${item.id}：${item.name}`} aria-pressed={style === item.id} onClick={() => change(item.id)}>{item.id}</button>)}</div><small>{pcStyles.find(item => item.id === style)!.name} · 架空値</small></div>;
}
