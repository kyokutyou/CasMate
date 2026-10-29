import { useEffect, useRef, useState } from 'react';
import { emptyPcStatus, freshPcStatus, type PcMeasurement, type PcStatusSnapshot } from '../../shared/pc-status';
import { nextLoad, type LoadHistory } from '../pc-load';

const reasons = { valid: '取得済み', pending: '未取得', unsupported: '非対応', denied: '権限不足', failed: '取得失敗', stopped: '更新停止' };
const tones = { normal: '通常', raised: '高め', high: '高負荷' };
const value = (m: PcMeasurement, unit: number, digits: number) => m.value === null ? '—' : (m.value / unit).toFixed(m.value / unit >= 100 ? 0 : digits);
const ratio = (used: PcMeasurement, total: PcMeasurement) => used.value === null || !total.value ? null : used.value / total.value * 100;

export function PcStatus() {
  const [snapshot, setSnapshot] = useState(() => emptyPcStatus());
  const [selected, setSelected] = useState<string | null>(null);
  const [histories, setHistories] = useState<(LoadHistory | null)[]>([null, null, null, null]);
  const selectedRef = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    let active: AbortController | null = null;
    let cached = emptyPcStatus();
    const update = (data: PcStatusSnapshot) => {
      if (!alive) return;
      const fresh = freshPcStatus(data, Date.now());
      if (selectedRef.current === null && fresh.gpus.length) {
        const dedicated = fresh.gpus.filter(g => g.kind === 'dedicated');
        const chosen = dedicated.length ? dedicated.reduce((best, g) => (g.capacity.value ?? 0) > (best.capacity.value ?? 0) ? g : best) : fresh.gpus[0];
        selectedRef.current = chosen.id; setSelected(chosen.id);
      }
      const gpu = fresh.gpus.find(g => g.id === selectedRef.current);
      const readings = [gpu?.usage.value ?? null, gpu ? ratio(gpu.dedicatedMemory, gpu.capacity) : null, ratio(fresh.memory.used, fresh.memory.total), fresh.application.cpu.value];
      const times = [gpu?.usage.lastSuccessAt ?? null, gpu?.dedicatedMemory.lastSuccessAt ?? null, fresh.memory.used.lastSuccessAt, fresh.application.cpu.lastSuccessAt];
      setSnapshot(fresh);
      setHistories(previous => readings.map((reading, i) => nextLoad(previous[i], reading, times[i])));
    };
    const poll = async () => {
      if (document.visibilityState === 'hidden' || active) return;
      active = new AbortController();
      const request = active;
      const timeout = window.setTimeout(() => request.abort(), 3_000);
      try {
        const token = document.querySelector<HTMLMetaElement>('meta[name="casmate-management"]')?.content;
        if (!token) { update(cached); return; }
        const response = await fetch('/api/management/pc-status', { signal: request.signal, cache: 'no-store', headers: { 'X-CasMate-Management': token } });
        if (!response.ok) throw new Error('PC状態を取得できません。');
        const data = await response.json() as PcStatusSnapshot;
        if (!request.signal.aborted) { cached = data; update(data); }
      } catch { update(cached); }
      finally { window.clearTimeout(timeout); if (active === request) active = null; }
    };
    const visibility = () => {
      active?.abort(); active = null;
      // Clear the presentation immediately on return; the server restarts the shared sampler.
      if (document.visibilityState !== 'hidden') { update(emptyPcStatus()); void poll(); }
    };
    void poll();
    const timer = window.setInterval(() => { update(cached); void poll(); }, 2_000);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive = false; clearInterval(timer); active?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const gpu = snapshot.gpus.find(g => g.id === selected);
  const missing: PcMeasurement = { value: null, status: selected ? 'failed' : snapshot.gpuStatus, lastSuccessAt: null };
  const usage = gpu?.usage ?? missing;
  const capacity = gpu?.capacity ?? missing;
  const vram = gpu && capacity.value ? gpu.dedicatedMemory : { ...missing, status: gpu ? 'unsupported' as const : missing.status };
  const memory = snapshot.memory;
  const metricText = (used: PcMeasurement, total: PcMeasurement) => `${value(used, 2 ** 30, 1)}/${value(total, 2 ** 30, 1)}`;
  const load = (i: number) => histories[i] ? tones[histories[i]!.tone] : '未取得・更新停止';
  const color = (i: number) => histories[i] ? `pc-${histories[i]!.tone}` : 'pc-neutral';
  const available = histories.slice(0, 3).filter(h => h !== null);
  const overall = available.some(h => h.tone === 'high') ? 'high' : available.some(h => h.tone === 'raised') ? 'raised' : available.length ? 'normal' : 'neutral';
  const close = () => { dialog.current?.close(); opener.current?.focus(); };
  const detail = (name: string, text: string, unit: string, m: PcMeasurement, i?: number) => <div className="pc-detail-row"><dt>{name}<small>{reasons[m.status]}{m.lastSuccessAt !== null ? `・${new Date(m.lastSuccessAt).toLocaleTimeString()}` : ''}</small></dt><dd className={i === undefined ? '' : color(i)}>{text} <small>{unit}</small>{i !== undefined && <small>{load(i)}</small>}</dd></div>;
  return <>
    <button ref={opener} className="pc-status-button" aria-label="PC状態の詳細を開く" onClick={() => dialog.current?.showModal()}>
      <span className={`pc-overall pc-${overall}`} aria-label={available.length < 3 ? '一部未取得' : '負荷の目安'}>●{available.length < 3 && '?'}</span>
      <span className="pc-reading"><small>GPU</small><span className={color(0)}>{value(usage, 1, 0)}<small>%</small></span></span>
      <span className="pc-reading"><small>VRAM</small><span className={color(1)}>{capacity.value ? metricText(vram, capacity) : '—'}<small>GiB</small></span></span>
      <span className="pc-reading"><small>メモリ</small><span className={color(2)}>{metricText(memory.used, memory.total)}<small>GiB</small></span></span>
      <span aria-hidden="true">›</span>
    </button>
    <dialog ref={dialog} className="pc-dialog" aria-labelledby="pc-dialog-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => opener.current?.focus()}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="pc-dialog-heading"><h2 id="pc-dialog-title">PC状態</h2><button autoFocus onClick={close}>閉じる</button></div>
      <div className="pc-dialog-body" tabIndex={0} aria-label="PC状態の詳細内容">
        <label>対象GPU<select value={selected ?? ''} onChange={event => {
          selectedRef.current = event.target.value; setSelected(event.target.value); setHistories(previous => [null, null, previous[2], previous[3]]);
        }}><option value="" disabled>GPU未取得</option>{selected && !gpu && <option value={selected}>選択したGPUは取得不能</option>}{snapshot.gpus.map(g => <option key={g.id} value={g.id}>{g.name}（{g.kind === 'dedicated' ? '専用' : '内蔵'}）</option>)}</select></label>
        <h3>PC全体</h3><dl>
          {detail('GPU使用率', value(usage, 1, 0), '%', usage, 0)}
          {detail('GPU専用メモリ', capacity.value ? metricText(vram, capacity) : '—', 'GiB', vram, 1)}
          {detail('物理メモリ', metricText(memory.used, memory.total), 'GiB', memory.used, 2)}
          {gpu && detail('GPU共有メモリ', value(gpu.sharedMemory, 2 ** 30, 1), 'GiB', gpu.sharedMemory)}
        </dl>
        {gpu && capacity.value === 0 && <p>専用メモリがありません。共有メモリはVRAMへ含めません。</p>}

        <h3>きゃすメイト</h3><dl>{detail('CPU使用率', value(snapshot.application.cpu, 1, 1), '%', snapshot.application.cpu, 3)}{detail('使用メモリ', value(snapshot.application.memory, 2 ** 20, 0), 'MiB', snapshot.application.memory)}</dl>
        <details><summary>計測方法</summary><p>GPU使用率は同じGPUのエンジンごとに集計し、最も使用率が高いエンジンを表示します。</p><p>本体の各プロセスと、起動した計測・音声認識・VOICEVOX・FFmpegの関連処理を含みます。外部起動済みのVOICEVOX、OBS、通常ブラウザは含みません。CPUはPC全体を100%、メモリは専有する物理メモリの合計です。</p></details>
        {snapshot.application.incomplete && <p className="field-error">一部未取得のため、アプリ負荷の合計は完全ではありません。</p>}
        <p>計測：{{ starting: '準備中', running: '取得中', stopped: '更新停止', retrying: '取得失敗・再試行待ち', unsupported: '非対応' }[snapshot.state]}。{snapshot.measuredAt ? `最終計測 ${new Date(snapshot.measuredAt).toLocaleTimeString()}` : 'まだ計測できていません。'}</p>
        <p>色は負荷の目安です。故障や配信失敗を示すものではありません。</p>
      </div>
    </dialog>
  </>;
}
