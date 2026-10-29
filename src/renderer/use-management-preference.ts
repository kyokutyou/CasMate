import { useCallback, useEffect, useRef, useState } from 'react';

// A local appearance edit owns its preview independently of the port draft.
// A newer synchronized snapshot wins after the pending save has completed.
export function useManagementPreference<T extends string>(saved: T, revision: number | undefined) {
  const [preview, setPreview] = useState<T>();
  const edit = useRef<{ id:T; dirty:boolean; observed?:T } | undefined>(undefined);
  useEffect(() => {
    if (edit.current?.dirty && edit.current.id !== saved) edit.current.observed = saved;
    else { edit.current = undefined; setPreview(undefined); }
  }, [saved, revision]);
  const choose = useCallback((id:T) => { edit.current = { id, dirty:true }; setPreview(id); }, []);
  const recover = useCallback((id:T) => {
    if (edit.current?.id === id) { edit.current = undefined; setPreview(undefined); }
  }, []);
  const finish = useCallback((id:T, persisted:T) => {
    if (edit.current?.id !== id) return;
    edit.current.dirty = false;
    if (edit.current.observed !== undefined || persisted === id) {
      edit.current = undefined; setPreview(persisted);
    }
  }, []);
  return { value:preview ?? saved, edit, choose, recover, finish };
}
