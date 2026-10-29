import { useRef, useState } from 'react';
import type { AppSettings, ConnectionKey } from '../shared/types';
import type { useApplicationState } from './api';
import type { SourceOperation } from './components/CommentAcquisitionPanel';
import { connectionLabel } from './messages';
import type { useAutoSavingSettings } from './use-auto-saving-settings';

interface SourceActionsOptions {
  saving: Pick<ReturnType<typeof useAutoSavingSettings>, 'draft' | 'changeSection' | 'saveSectionNow' | 'hasDeferredSave' | 'hasPendingSave' | 'hasSaveFailure' | 'getSavedSection'>;
  savedSources: AppSettings['sources'] | undefined;
  api: Pick<ReturnType<typeof useApplicationState>, 'sourceAction' | 'mutate' | 'snapshot'>;
  onNotice(notice: { message: string; tone: 'success' | 'error' } | null): void;
}

export function useCommentSourceActions({ saving, savedSources, api, onNotice }: SourceActionsOptions) {
  const [operation, setOperation] = useState<SourceOperation | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [intervalInvalid, setIntervalInvalid] = useState(false);
  const { draft, changeSection, saveSectionNow, hasDeferredSave, hasPendingSave, hasSaveFailure, getSavedSection } = saving;
  const editBase = useRef(savedSources);
  const editVersion = useRef(0);
  const editSources = (value: AppSettings['sources'], immediate: boolean) => {
    if (!hasPendingSave('sources')) editBase.current = savedSources;
    editVersion.current++;
    setError(''); onNotice(null);
    if (immediate) return saveSectionNow('sources', value);
    changeSection('sources', value);
    return Promise.resolve();
  };
  const label = (source: ConnectionKey) => connectionLabel(source, api.snapshot?.sourceStatuses[source]);

  const run = async (kind: SourceOperation, action: () => Promise<unknown>, success: string) => {
    if (pending.current) return;
    pending.current = true;
    setOperation(kind); setError(''); onNotice(null);
    try {
      await action();
      onNotice({ message: success, tone: 'success' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'コメント取得の操作に失敗しました。';
      setError(message); onNotice({ message, tone: 'error' });
    } finally {
      pending.current = false; setOperation(null);
    }
  };

  const toggleSource = async (source: ConnectionKey, enabled: boolean, reconnect = false) => {
    if (!draft || !savedSources) return;
    let preserveDeferredSources = hasDeferredSave('sources');
    const hadPendingSources = hasPendingSave('sources');
    const base = editBase.current ?? savedSources;
    const version = editVersion.current;
    const draftSources = { ...draft.sources, [source]: { ...draft.sources[source], enabled } };
    const restoreEdits = (edited: AppSettings['sources']) => {
      if (!preserveDeferredSources || version !== editVersion.current) return;
      const latest = getSavedSection('sources') ?? savedSources;
      const value = mergeSourceEdits(base, edited, latest);
      if (JSON.stringify(value) !== JSON.stringify(latest)) changeSection('sources', value);
    };
    try {
      await saveSectionNow('sources', latest => {
        // Earlier failed edits still belong to the editor, even when this target saves.
        if (hadPendingSources && hasSaveFailure('sources')) preserveDeferredSources = true;
        return { ...latest, [source]: draftSources[source] };
      }, draftSources);
    } catch (cause) {
      restoreEdits(draft.sources);
      throw cause;
    }
    restoreEdits(draftSources);
    await api.sourceAction(source, reconnect ? 'reconnect' : enabled ? 'start' : 'stop');
  };

  return {
    operation, error, intervalInvalid, setIntervalInvalid,
    change: (value: AppSettings['sources']) => { void editSources(value, false); },
    save: (value: AppSettings['sources']) => editSources(value, true),
    toggle: (source: ConnectionKey, enabled: boolean) => run(source,
      () => toggleSource(source, enabled), label(source) + (enabled ? 'の接続を要求しました。' : 'を停止しました。')),
    reconnect: (source: ConnectionKey) => run(source,
      () => toggleSource(source, draft?.sources[source].enabled ?? false, true), label(source) + 'の再接続を要求しました。'),
    startAll: () => run('start-all', async () => {
      if (!draft) return;
      await saveSectionNow('sources', draft.sources);
      await api.mutate('/api/sources/start-all');
    }, '有効な接続の開始を要求しました。'),
    stopAll: () => run('stop-all', () => api.mutate('/api/sources/stop-all'), 'すべて停止しました。'),
    setAutoConnect: (autoConnect: boolean) => run('auto-connect', async () => {
      if (draft) await saveSectionNow('sources', { ...draft.sources, autoConnect });
    }, '自動接続の設定を変更しました。'),
  };
}

function changedFields<T extends object>(base: T, edited: T, latest: T): T {
  const result = { ...latest };
  for (const key of Object.keys(edited) as Array<keyof T>) {
    if (JSON.stringify(edited[key]) !== JSON.stringify(base[key])) result[key] = edited[key];
  }
  return result;
}

/** Carry only local edits; untouched fields can have been corrected by the backend. */
function mergeSourceEdits(base: AppSettings['sources'], edited: AppSettings['sources'], latest: AppSettings['sources']): AppSettings['sources'] {
  return {
    ...changedFields(base, edited, latest),
    youtube: changedFields(base.youtube, edited.youtube, latest.youtube),
    twitch: changedFields(base.twitch, edited.twitch, latest.twitch),
    shitaraba: { ...changedFields(base.shitaraba, edited.shitaraba, latest.shitaraba),
      nextThread: changedFields(base.shitaraba.nextThread, edited.shitaraba.nextThread, latest.shitaraba.nextThread) },
  };
}
