import { useContext, useLayoutEffect, useRef } from 'react';
import { ManagementNavigation, SetupPresentation, type ManagementEditor } from '../management-navigation';
import { CompactFeedback } from './CompactFeedback';

interface Props {
  kind: 'comment' | 'speech';
  ready: boolean;
  message: string;
  reserve: string[];
}

/** Keep the action space and return target when a prerequisite becomes ready. */
export function InitialSetupPhonePrerequisite({ kind, ready, message, reserve }: Props) {
  const navigation = useContext(ManagementNavigation);
  const { selectionPending } = useContext(SetupPresentation);
  const status = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const focusedAction = useRef(false);
  const entryId = `setup-phone-${kind}-settings`;
  const label = kind === 'comment' ? '先にコメント接続を設定する' : '先に読み上げを準備する';
  const editor: ManagementEditor = kind === 'comment' ? 'sources' : 'commentSpeech';
  const pending = Boolean(navigation?.initialSetupPending || selectionPending);
  useLayoutEffect(() => {
    if (ready && focusedAction.current) {
      if (document.activeElement === document.body || document.activeElement === action.current) status.current?.focus({ preventScroll: true });
      focusedAction.current = false;
    }
  }, [ready]);
  return <div className={`setup-phone-prerequisite setup-phone-${kind}-preparation`}>
    <div ref={status} id={ready ? entryId : undefined} tabIndex={-1} className="setup-phone-prerequisite-status" data-ready={ready}>
      <CompactFeedback role="status" reserve={reserve}>{message}</CompactFeedback>
    </div>
    <div className="setup-phone-prerequisite-action" style={{ visibility: ready ? 'hidden' : 'visible' }} aria-hidden={ready}>
      <button ref={action} type="button" id={ready ? undefined : entryId} className="secondary" disabled={ready} aria-disabled={pending}
        onFocus={() => { focusedAction.current = true; }} onBlur={event => { if (event.relatedTarget) focusedAction.current = false; }}
        onClick={event => { if (!ready && !pending) navigation?.open(editor, event.currentTarget); }}>{label}</button>
    </div>
  </div>;
}
