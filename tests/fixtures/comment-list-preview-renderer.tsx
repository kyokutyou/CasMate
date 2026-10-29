import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CommentListPanel } from '../../src/renderer/components/CommentListPanel';
import { createDefaultSettings } from '../../src/main/core/settings';
import { managementThemeStyle } from '../../src/renderer/management-themes';
import { managementTextSizeStyle } from '../../src/renderer/management-text-sizes';
import '../../src/renderer/styles.css';

function Harness() {
  const [settings, setSettings] = useState(createDefaultSettings().commentList);
  return <main className="management-shell" data-management-theme="ocean" data-management-text-size="medium"
    style={{ ...managementThemeStyle('ocean'), ...managementTextSizeStyle('medium'), display: 'block', padding: 16 }}>
    <CommentListPanel settings={settings} windowVisible={false} commentsUrl="/comments"
      onChange={setSettings} onSave={async value => setSettings(value)}
      onToggleWindow={async () => {}} onSuccess={() => {}} onError={() => {}} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
