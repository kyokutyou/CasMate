import type { ObsSourceTarget } from '../../shared/obs-source-registration';

export function ObsSourceIcon({ name }: { name: Extract<ObsSourceTarget, { kind: 'overlay' }>['overlay'] | 'copy' | 'smartphone' }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'comments' && <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3Z"/><path d="M7 9h10M7 13h7"/></>}
    {name === 'speech' && <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></>}
    {name === 'character' && <><path d="m4 9 1-6 5 3h4l5-3 1 6v7a6 6 0 0 1-6 5h-4a6 6 0 0 1-6-5Z"/><path d="M8 12v2M16 12v2m-6 3 2 1 2-1"/></>}
    {name === 'effects' && <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>}
    {name === 'smartphone' && <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/></>}
  </svg>;
}
