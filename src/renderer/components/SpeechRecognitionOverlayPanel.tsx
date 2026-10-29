import { useCallback, useContext, useEffect, useState } from 'react';
import type { SpeechRecognitionOverlaySettings } from '../../shared/types';
import { ManagementNavigation } from '../management-navigation';
import { SettingsCard } from './SettingsCard';
import { OverlayNumber } from './OverlayNumber';
import { ObsDesignButton } from './ObsDesignButton';
import './comment-overlay-panel.css';

interface Props {
  onEditDesign?(): Promise<unknown> | void;
  settings: SpeechRecognitionOverlaySettings;
  saveError?: string;
  onChange(settings: SpeechRecognitionOverlaySettings): void;
  onSave(settings: SpeechRecognitionOverlaySettings): Promise<unknown>;
  onOperationStart(): void;
  loadFonts?: () => Promise<string[]>;
}

export function SpeechRecognitionOverlayPanel(props: Props) {
  const navigation = useContext(ManagementNavigation);
  const active = !navigation || navigation.editor === 'speechRecognitionOverlay';
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return active || visited ? <SpeechRecognitionOverlayEditor {...props} active={active}/> : null;
}

function SpeechRecognitionOverlayEditor({ settings, saveError, onChange, onEditDesign }: Props & { active: boolean }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reportError = useCallback((field: string, error: string) => setErrors(current => current[field] === error ? current : { ...current, [field]: error }), []);
  return <SettingsCard cardId="speechRecognitionOverlay" title="OBS音声認識表示" eyebrow="OBS SPEECH" className="comment-overlay-panel speech-recognition-overlay-panel" saveError={saveError} navigationWarning={Object.values(errors).filter(Boolean).join(' ')}>
    <section className="overlay-setting-section" aria-labelledby="speech-overlay-duration"><h3 id="speech-overlay-duration">字幕の表示</h3>
      <OverlayNumber field="displayDurationSeconds" label="表示時間" unit="秒" min={1} max={60} value={settings.displayDurationSeconds} onError={reportError} onChange={value => onChange({ ...settings, displayDurationSeconds: value })}/>
    </section>
    <ObsDesignButton target="speech" onEdit={onEditDesign}/>
  </SettingsCard>;
}
