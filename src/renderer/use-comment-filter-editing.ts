import { useRef } from 'react';
import { canonicalizeNgWords } from '../shared/comment-filter';
import type { CommentFilterSettings } from '../shared/types';
import type { useAutoSavingSettings } from './use-auto-saving-settings';

interface FilterEditingOptions {
  saving: Pick<ReturnType<typeof useAutoSavingSettings>, 'draft' | 'changeSection' | 'saveSectionNow' | 'hasDeferredSave'>;
  saved: CommentFilterSettings | undefined;
  clearNotice(): void;
}

export function useCommentFilterEditing({ saving, saved, clearNotice }: FilterEditingOptions) {
  const editVersion = useRef(0);
  const { draft, changeSection, saveSectionNow, hasDeferredSave } = saving;

  return {
    change: (value: CommentFilterSettings) => {
      editVersion.current += 1;
      clearNotice();
      changeSection('commentFilter', value);
    },
    toggleAsciiArt: async (enabled: boolean) => {
      if (!draft || !saved) return;
      clearNotice();
      const version = ++editVersion.current;
      const preserveDeferredWords = hasDeferredSave('commentFilter') ||
        JSON.stringify(canonicalizeNgWords(draft.commentFilter.ngWords)) !== JSON.stringify(canonicalizeNgWords(saved.ngWords));
      const draftValue = { ...draft.commentFilter, asciiArtEnabled: enabled };
      try {
        await saveSectionNow('commentFilter', latest => ({ ...latest, asciiArtEnabled: enabled }), draftValue);
      } finally {
        // New input has scheduled its own save; never replace it with the captured draft.
        if (preserveDeferredWords && editVersion.current === version) changeSection('commentFilter', draftValue);
      }
    },
  };
}
