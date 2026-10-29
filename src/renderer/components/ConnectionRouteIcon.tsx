type IconName = 'phone' | 'router' | 'pc' | 'arrow' | 'check' | 'automatic' | 'manual' | 'plus' | 'remove' | 'refresh' | 'shield' | 'tools' | 'key' | 'signal';

/** One stroke style for the route, communication states and their actions. */
export function ConnectionRouteIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="sp-route-icon" data-icon={name} viewBox="0 0 24 24" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'phone' && <><rect x="6.5" y="2" width="11" height="20" rx="2.5"/><path d="M10 5h4M11 19h2M9.5 9.5h5M9.5 12.5h3"/></>}
    {name === 'router' && <><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M6 13V7M18 13V7M7 17h.01M10 17h.01M16 17h2M9 7a4.2 4.2 0 0 1 6 0M7 4a7.2 7.2 0 0 1 10 0"/></>}
    {name === 'pc' && <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M10 17v4M14 17v4M2 13h20M10 8l2 2 3-3"/></>}
    {name === 'arrow' && <path d="M3 12h17m-6-6 6 6-6 6"/>}
    {name === 'check' && <path d="m5 12 4 4L19 6"/>}
    {name === 'automatic' && <><path d="m12 2-8 12h7l-1 8 10-13h-8l1-7Z"/></>}
    {name === 'manual' && <><path d="M4 6h16M4 12h16M4 18h16"/><rect x="7" y="4" width="4" height="4" rx="1" fill="var(--sp-direct-inset, #14242d)"/><rect x="14" y="10" width="4" height="4" rx="1" fill="var(--sp-direct-inset, #14242d)"/><rect x="8" y="16" width="4" height="4" rx="1" fill="var(--sp-direct-inset, #14242d)"/></>}
    {name === 'plus' && <path d="M12 5v14M5 12h14"/>}
    {name === 'remove' && <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>}
    {name === 'refresh' && <><path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M16 16h5v5"/></>}
    {name === 'shield' && <><path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Z"/><path d="m8 11 3 3 5-5"/></>}
    {name === 'tools' && <><path d="m14 4 4 4 4-4a7 7 0 0 1-9 9l-8 8a2.1 2.1 0 0 1-3-3l8-8a7 7 0 0 1 4-9v3Z"/></>}
    {name === 'key' && <><circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3"/></>}
    {name === 'signal' && <><path d="M4 17v4M9 13v8M14 9v12M19 4v17"/></>}
  </svg>;
}
