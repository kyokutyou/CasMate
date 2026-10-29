import { createRoot } from 'react-dom/client';
import { SimpleCharacterSettingsPage } from '../../src/renderer/pages/SimpleCharacterSettingsPage';
import '../../src/renderer/styles.css';

createRoot(document.getElementById('root')!).render(<SimpleCharacterSettingsPage />);
