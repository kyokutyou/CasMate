import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ManagementNavigation } from '../management-navigation';
import { messages } from '../messages';

interface Props {
  cardId: string;
  title: string;
  eyebrow: string;
  summary?: ReactNode;
  actions?: ReactNode;
  warning?: ReactNode;
  saveError?: string;
  navigationWarning?: string;
  children: ReactNode;
  className?: string;
  onExpandedChange?: (expanded: boolean) => void;
}

export function SettingsCard({ cardId, title, eyebrow, summary, actions, warning, saveError, navigationWarning, children, className = '', onExpandedChange }: Props) {
  const navigation = useContext(ManagementNavigation);
  const selected = navigation?.editor === cardId;
  const [visited, setVisited] = useState(selected);
  useEffect(() => { if (selected) setVisited(true); }, [selected]);
  const reportError = navigation?.reportError;
  const reportedError = saveError || navigationWarning;
  useEffect(() => { reportError?.(cardId, reportedError); }, [cardId, reportedError, reportError]);
  const storageKey = `casmate.management.cards.${cardId}`;
  const [expanded, setExpanded] = useState(() => {
    if (navigation) return true;
    try { return localStorage.getItem(storageKey) !== 'false'; }
    catch { return true; }
  });
  const contentId = useId();
  const headingId = useId();
  const content = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (expanded && content.current?.contains(document.activeElement)) button.current?.focus();
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
    try { localStorage.setItem(storageKey, String(next)); }
    catch { /* Keep the current screen usable when storage is unavailable. */ }
  };

  return <section className={`panel settings-card ${className}`} aria-labelledby={headingId}
    hidden={navigation ? !selected : false}>
    <div className="panel-heading">
      <div><p className="eyebrow">{eyebrow}</p><h2 id={headingId}>{title}</h2></div>
      <div className="button-row">
        {actions}
        {!navigation && <button ref={button} type="button" className="secondary small card-toggle"
          aria-label={`${title}：${expanded ? messages.closeDetails : messages.openDetails}`}
          aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {expanded ? messages.closeDetails : messages.openDetails}
        </button>}
      </div>
    </div>
    {summary && <div className="card-summary">{summary}</div>}
    {warning && <div className="field-error card-warning">{warning}</div>}
    {saveError && <p className="field-error card-warning">{saveError}</p>}
    <div ref={content} id={contentId} className="card-details" hidden={!expanded}>
      {(!navigation || selected || visited) && children}
    </div>
  </section>;
}
