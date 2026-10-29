import { useCallback, useEffect, useRef, useState } from 'react';
import { validateObsControlPhrases, type ObsControlView } from '../shared/obs-control';

type Group = 'connection' | 'phrases' | 'publication' | 'enabled' | 'voiceEnabled' | 'androidEnabled';
const groups: Group[] = ['connection', 'phrases', 'publication', 'enabled', 'voiceEnabled', 'androidEnabled'];
const fromView = (view: ObsControlView) => ({
  connection: { port: String(view.obsPort), password: '' },
  phrases: { ...view.phrases },
  publication: { lanEnabled: view.publication.lanEnabled, tailscaleEnabled: view.publication.tailscaleEnabled, port: String(view.publication.port) },
  enabled: view.enabled, voiceEnabled: view.voiceEnabled, androidEnabled: view.androidEnabled,
});
type Draft = ReturnType<typeof fromView>;
const validPort = (value: string, minimum: number) => /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= 65535;

/** OBS has its own protected store and a connection-field commit boundary. */
export function useObsControlSettings(view: ObsControlView, configure: (patch: unknown) => Promise<unknown>) {
  const [draft, setDraft] = useState(() => fromView(view));
  const [errors, setErrors] = useState<Partial<Record<Group, string>>>({});
  const [saving, setSaving] = useState(0);
  const [unsaved, setUnsaved] = useState(false);
  const latest = useRef(draft);
  const remote = useRef(fromView(view));
  const saveAction = useRef(configure);
  const dirty = useRef(new Set<Group>());
  const revisions = useRef(new Map<Group, number>());
  const timers = useRef(new Map<Group, ReturnType<typeof setTimeout>>());
  const composing = useRef(new Set<Group>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => { saveAction.current = configure; }, [configure]);
  useEffect(() => {
    const incoming = fromView(view);
    for (const group of groups) {
      if (!dirty.current.has(group) && JSON.stringify(incoming[group]) !== JSON.stringify(remote.current[group])) {
        latest.current = { ...latest.current, [group]: incoming[group] };
      }
    }
    remote.current = incoming;
    setDraft(latest.current);
  }, [view]);
  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    return () => { mounted.current = false; for (const timer of pendingTimers.values()) clearTimeout(timer); pendingTimers.clear(); };
  }, []);

  const save = useCallback((group: Group): Promise<boolean> => {
    clearTimeout(timers.current.get(group)); timers.current.delete(group);
    const version = revisions.current.get(group);
    const value = latest.current[group];
    const operation = queue.current.then(async () => {
      if (!mounted.current || composing.current.has(group) || revisions.current.get(group) !== version) return false;
      if (!dirty.current.has(group)) return true;
      let patch: unknown;
      const savedVersions = new Map<Group, number | undefined>([[group, version]]);
      try {
        if (group === 'connection') {
          const connection = value as Draft['connection'];
          if (!validPort(connection.port, 1)) throw new Error('OBSポートは1〜65535の整数を入力してください。');
          if (connection.password.length > 256) throw new Error('パスワードは256文字以内で入力してください。');
          // A failed initial enable remains an unsaved intent until credentials are supplied.
          const includeEnabled = dirty.current.has('enabled');
          if (includeEnabled) savedVersions.set('enabled', revisions.current.get('enabled'));
          patch = { port: Number(connection.port), ...(connection.password ? { password: connection.password } : {}),
            ...(includeEnabled ? { enabled: latest.current.enabled } : {}) };
        } else if (group === 'phrases') {
          try { patch = { phrases: validateObsControlPhrases(value) }; }
          catch { throw new Error('フレーズは1〜100文字で入力し、空白・句読点を除いても4つが異なる内容にしてください。'); }
        } else if (group === 'publication') {
          const publication = value as Draft['publication'];
          if (!validPort(publication.port, 1024)) throw new Error('専用待受ポートは1024〜65535の整数を入力してください。');
          patch = { publication: { ...publication, port: Number(publication.port) } };
        } else patch = { [group]: value };
        setSaving(count => count + 1);
        try { await saveAction.current(patch); }
        finally { if (mounted.current) setSaving(count => count - 1); }
        if (!mounted.current) return false;
        for (const [savedGroup, savedVersion] of savedVersions) {
          if (revisions.current.get(savedGroup) !== savedVersion) continue;
          dirty.current.delete(savedGroup);
          if (savedGroup === 'connection') {
            latest.current = { ...latest.current, connection: { ...latest.current.connection, password: '' } };
            setDraft(latest.current);
          }
          setErrors(current => ({ ...current, [savedGroup]: undefined }));
        }
        setUnsaved(dirty.current.size > 0);
        return revisions.current.get(group) === version;
      } catch (error) {
        if (mounted.current && revisions.current.get(group) === version) {
          setErrors(current => ({ ...current, [group]: error instanceof Error ? error.message : '設定を保存できません。入力を確認して再試行してください。' }));
        }
        return false;
      }
    });
    queue.current = operation;
    return operation;
  }, []);

  const schedule = useCallback((group: Group) => {
    clearTimeout(timers.current.get(group)); timers.current.delete(group);
    if (!composing.current.has(group)) timers.current.set(group, setTimeout(() => { void save(group); }, 500));
  }, [save]);
  const change = <K extends Group>(group: K, value: Draft[K], timing: 'deferred' | 'immediate' | 'blur') => {
    latest.current = { ...latest.current, [group]: value };
    setDraft(latest.current); dirty.current.add(group); setUnsaved(true);
    revisions.current.set(group, (revisions.current.get(group) ?? 0) + 1);
    setErrors(current => ({ ...current, [group]: undefined }));
    if (timing === 'immediate') return save(group);
    if (timing === 'deferred') schedule(group);
    return Promise.resolve(true);
  };
  const composition = (group: Group, active: boolean) => {
    if (active) { composing.current.add(group); clearTimeout(timers.current.get(group)); timers.current.delete(group); }
    else { composing.current.delete(group); if (group !== 'connection' && dirty.current.has(group)) schedule(group); }
  };
  const flush = async () => {
    if (composing.current.size) return false;
    const results = await Promise.all(groups.filter(group => dirty.current.has(group)).map(save));
    await queue.current;
    return results.every(Boolean) && dirty.current.size === 0 && composing.current.size === 0;
  };
  return { draft, errors, saving: saving > 0, unsaved, change, save, composition, flush };
}
