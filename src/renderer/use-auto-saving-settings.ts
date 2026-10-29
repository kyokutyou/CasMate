import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, AppSnapshot, SettingsSection } from '../shared/types';
import { messages } from './messages';

export const AUTO_SAVE_DELAY_MS = 500;

type SaveSettings = <K extends SettingsSection>(
  section: K,
  value: AppSettings[K],
) => Promise<unknown>;

interface SaveWaiter {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

interface PendingSave {
  section: SettingsSection;
  value(): AppSettings[SettingsSection];
  version: number;
  waiters: SaveWaiter[];
}

const sections: SettingsSection[] = [
  'aiListener',
  'application',
  'sources',
  'commentOverlay',
  'speechRecognitionOverlay',
  'commentList',
  'commentFilter',
  'commentSpeech',
  'mobileSpeech',
  'character',
  'textEffects',
];

export function useAutoSavingSettings(
  settings: AppSettings | undefined,
  settingsRevision: number | undefined,
  saveSettings: SaveSettings,
  onError: (message: string) => void,
) {
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saveErrors, setSaveErrors] = useState<Partial<Record<SettingsSection, string>>>({});
  const dirtySections = useRef(new Set<SettingsSection>());
  const versions = useRef(new Map<SettingsSection, number>());
  const timers = useRef(new Map<SettingsSection, number>());
  const queuedSections = useRef<SettingsSection[]>([]);
  const queuedSaves = useRef(new Map<SettingsSection, PendingSave>());
  const supersededWaiters = useRef(new Map<SettingsSection, SaveWaiter[]>());
  const saving = useRef(false);
  const saveRef = useRef(saveSettings);
  const errorRef = useRef(onError);
  const mounted = useRef(true);
  const persisted = useRef({ settings, revision: settingsRevision ?? -1 });
  const failedSaves = useRef(new Set<SettingsSection>());

  useEffect(() => { saveRef.current = saveSettings; }, [saveSettings]);
  useEffect(() => { errorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!settings) return;
    if ((settingsRevision ?? -1) < persisted.current.revision) return;
    persisted.current = { settings, revision: settingsRevision ?? -1 };
    setDraft((current) => {
      if (!current) return structuredClone(settings);
      const next = structuredClone(current);
      for (const section of sections) {
        if (!dirtySections.current.has(section)) {
          next[section] = structuredClone(settings[section]) as never;
        }
      }
      return next;
    });
  }, [settings, settingsRevision]);

  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of pendingTimers.values()) window.clearTimeout(timer);
      pendingTimers.clear();
    };
  }, []);

  const drainQueue = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (queuedSections.current.length > 0) {
        const section = queuedSections.current.shift();
        if (!section) continue;
        const pending = queuedSaves.current.get(section);
        if (!pending) continue;
        queuedSaves.current.delete(section);
        try {
          const value = pending.value();
          const beforeSave = persisted.current;
          const result = await saveRef.current(pending.section, value as never);
          failedSaves.current.delete(section);
          const saved = (result as { snapshot?: AppSnapshot } | null | undefined)?.snapshot;
          if (saved && Number.isSafeInteger(saved.settingsRevision)) {
            if (saved.settingsRevision >= persisted.current.revision) {
              persisted.current = { settings: saved.settings, revision: saved.settingsRevision };
            }
          } else if (persisted.current === beforeSave && beforeSave.settings) {
            // A callback without a snapshot cannot supersede a newer synchronization.
            persisted.current = { ...beforeSave, settings: { ...beforeSave.settings, [section]: value } };
          }
          if (versions.current.get(section) === pending.version) {
            dirtySections.current.delete(section);
            if (mounted.current) setSaveErrors((current) => ({ ...current, [section]: undefined }));
          }
          for (const waiter of pending.waiters) waiter.resolve(result);
        } catch (error) {
          failedSaves.current.add(section);
          if (mounted.current && versions.current.get(section) === pending.version) {
            setSaveErrors((current) => ({ ...current, [section]: messageOf(error) }));
            errorRef.current(messageOf(error));
          }
          for (const waiter of pending.waiters) waiter.reject(error);
        }
      }
    } finally {
      saving.current = false;
    }
  }, []);

  const enqueueSave = useCallback(
    <K extends SettingsSection>(section: K, value: AppSettings[K] | ((saved: AppSettings[K]) => AppSettings[K]), version: number) =>
      new Promise<unknown>((resolve, reject) => {
        // Partial writes must use the successful value of earlier serialized writes.
        const resolveValue = () => typeof value === 'function' ? value(persisted.current.settings![section]) : value;
        const queued = queuedSaves.current.get(section);
        if (queued) {
          queued.value = resolveValue;
          queued.version = version;
          queued.waiters.push({ resolve, reject });
        } else {
          const carriedWaiters = supersededWaiters.current.get(section) ?? [];
          supersededWaiters.current.delete(section);
          queuedSections.current.push(section);
          queuedSaves.current.set(section, {
            section,
            value: resolveValue,
            version,
            waiters: [...carriedWaiters, { resolve, reject }],
          });
        }
        void drainQueue();
      }),
    [drainQueue],
  );

  const prepareChange = useCallback(
    <K extends SettingsSection>(section: K, value: AppSettings[K]) => {
      const queued = queuedSaves.current.get(section);
      if (queued) {
        queuedSaves.current.delete(section);
        queuedSections.current = queuedSections.current.filter((item) => item !== section);
        const carriedWaiters = supersededWaiters.current.get(section) ?? [];
        supersededWaiters.current.set(section, [...carriedWaiters, ...queued.waiters]);
      }
      const timer = timers.current.get(section);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(section);
      const version = (versions.current.get(section) ?? 0) + 1;
      versions.current.set(section, version);
      dirtySections.current.add(section);
      setDraft((current) => current && ({
        ...current,
        [section]: structuredClone(value),
      }));
      return version;
    },
    [],
  );

  const changeSection = useCallback(
    <K extends SettingsSection>(section: K, value: AppSettings[K]) => {
      const version = prepareChange(section, value);
      const timer = window.setTimeout(() => {
        timers.current.delete(section);
        void enqueueSave(section, value, version).catch(() => undefined);
      }, AUTO_SAVE_DELAY_MS);
      timers.current.set(section, timer);
    },
    [enqueueSave, prepareChange],
  );

  const saveSectionNow = useCallback(
    <K extends SettingsSection>(section: K, value: AppSettings[K] | ((saved: AppSettings[K]) => AppSettings[K]), draftValue?: AppSettings[K]) => {
      const preview = draftValue ?? (typeof value === 'function' ? value(persisted.current.settings![section]) : value);
      const version = prepareChange(section, preview);
      return enqueueSave(section, value, version);
    },
    [enqueueSave, prepareChange],
  );

  const hasDeferredSave = useCallback(
    (section: SettingsSection) => timers.current.has(section),
    [],
  );

  // Includes debounce, queued requests, in-flight requests and failed unsaved edits.
  // A snapshot can contain new settings before their dependent preview has finished refreshing.
  const hasPendingSave = useCallback((section: SettingsSection) => dirtySections.current.has(section), []);
  const hasSaveFailure = useCallback((section: SettingsSection) => failedSaves.current.has(section), []);
  const getSavedSection = useCallback(<K extends SettingsSection>(section: K) => persisted.current.settings?.[section], []);

  // Editors with local validation can invalidate unsent saves immediately, then
  // submit through saveSectionNow once the latest input is valid and debounced.
  return { draft, changeSection, stageSection: prepareChange, saveSectionNow, hasDeferredSave, hasPendingSave, hasSaveFailure, getSavedSection, saveErrors };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : messages.settingsSaveFailed;
}
