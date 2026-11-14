import { newerPollState } from '../poll/poll-state';
import { useEffect, useState } from 'react';
import type { PollPublicSnapshot } from '../../shared/listener-poll';
import { PollDisplay } from '../poll/PollDisplay';
import { useTransparentDocument } from '../use-transparent-document';

export function PollOverlayPage() {
  useTransparentDocument();
  const [state, setState] = useState<PollPublicSnapshot | null>(null);
  useEffect(() => {
    const source = new EventSource('/api/overlays/poll/events');
    source.onmessage = event => { try { setState(current => newerPollState(current, JSON.parse(event.data))); } catch { setState(null); } };
    source.onerror = () => { setState(null); };
    return () => source.close();
  }, []);
  return <div className="poll-overlay">{state?.poll && <PollDisplay poll={state.poll} appearance={state.appearance}/>}</div>;
}
