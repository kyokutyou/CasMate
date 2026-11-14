import { newerPollState } from './poll-state';
import { useEffect, useRef, useState } from 'react';
import type { PollBallot, PollPublicSnapshot } from '../../shared/listener-poll';
import { PollDisplay } from './PollDisplay';

interface PersonalState { state: PollPublicSnapshot; ballot: PollBallot | null; cookieReady: boolean }
async function readState(): Promise<PersonalState> {
  const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('投票ページに接続できません。再接続しています。');
  return response.json();
}
export function ListenerPollPage() {
  const [state, setState] = useState<PollPublicSnapshot | null>(null);
  const [personal, setPersonal] = useState<{ pollId: string | null; ballot: PollBallot | null } | null>(null);
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('接続しています。');
  const pending = useRef(false), mounted = useRef(true), refresh = useRef<() => Promise<void>>(async () => undefined);
  const restart = useRef<() => void>(() => undefined);
  useEffect(() => {
    mounted.current = true; document.title = 'リスナー投票 | きゃすメイト';
    let cancelled = false, source: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined;
    let reading: Promise<void> | null = null, readAgain = false;
    const apply = (result: PersonalState) => {
      if (cancelled) return;
      setState(current => newerPollState(current, result.state));
      setPersonal({ pollId: result.state.poll?.id ?? null, ballot: result.ballot });
    };
    const sync = (): Promise<void> => {
      if (reading) { readAgain = true; return reading; }
      reading = (async () => {
        do {
          readAgain = false; let result = await readState();
          if (!result.cookieReady) result = await readState();
          if (!result.cookieReady) throw new Error('投票するには、このサイトのCookieを有効にしてください。');
          apply(result);
        } while (readAgain && !cancelled);
      })().finally(() => { reading = null; });
      return reading;
    };
    refresh.current = sync;
    const reconnect = () => {
      source?.close(); source = null; if (!cancelled) { setConnected(false); clearTimeout(retry); retry = setTimeout(() => { void connect(); }, 1500); }
    };
    restart.current = reconnect;
    const connect = async () => {
      try {
        await sync(); if (cancelled) return;
        const events = new EventSource('/api/events'); source = events;
        events.onopen = () => { if (!cancelled && source === events) { setConnected(true); setMessage('選択肢を押すと投票できます。締切前は選び直せます。'); } };
        events.onmessage = event => {
          if (cancelled || source !== events) return;
          try { setState(current => newerPollState(current, JSON.parse(event.data))); }
          catch { reconnect(); return; }
          void sync().catch(() => reconnect());
        };
        events.onerror = reconnect;
      } catch (error) {
        if (!cancelled) { setMessage(error instanceof Error ? error.message : '接続を確認してください。'); reconnect(); }
      }
    };
    const focus = () => { void sync().catch(() => reconnect()); };
    window.addEventListener('focus', focus); void connect();
    return () => { cancelled = true; mounted.current = false; clearTimeout(retry); source?.close(); window.removeEventListener('focus', focus); };
  }, []);
  const vote = async (option: number) => {
    if (pending.current || !connected || !state?.poll || state.poll.closedAt !== null) return;
    pending.current = true; setBusy(true); setMessage('投票を送っています。');
    const pollId = state.poll.id;
    try {
      const response = await fetch('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pollId, option, version: personal?.pollId === pollId ? personal.ballot?.version ?? 0 : 0, requestId: crypto.randomUUID() }), signal: AbortSignal.timeout(10_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? '投票を受け付けられませんでした。');
      if (mounted.current) { setState(current => newerPollState(current, result.state)); setPersonal({ pollId: result.state.poll?.id ?? null, ballot: result.ballot }); setMessage('投票を受け付けました。締切前は選び直せます。'); }
      // Synchronize again before allowing another vote, including another tab's concurrent change.
      await refresh.current();
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '結果を確認しています。');
      try { await refresh.current(); }
      catch { if (mounted.current) { setConnected(false); setMessage('投票結果を確認できません。再接続後に状態を確認してください。'); restart.current(); } }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <main className="poll-listener"><header className="poll-brand">▥ きゃすメイト <span>リスナー投票</span></header>
    <div className="poll-connection" role="status">{connected ? '● 接続中' : '↻ 再接続中'}{busy ? ' · 送信中' : ''}</div>
    {state?.poll ? <PollDisplay poll={state.poll} selected={personal?.pollId === state.poll.id ? personal.ballot?.option : undefined} disabled={!connected || busy || state.poll.closedAt !== null} onVote={option => void vote(option)}/> : <section className="poll-waiting"><span className="poll-kicker">LISTENER POLL</span><h1>次の投票を待っています</h1><p>配信者が投票を始めると、ここにお題が表示されます。</p></section>}
    <p className="poll-message" role="status">{message}</p>
    <footer>ログインなしで参加できます。同じブラウザの投票は1票として集計します。</footer>
  </main>;
}
