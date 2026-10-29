import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Dashboard } from '../../src/renderer/pages/Dashboard';
import '../../src/renderer/styles.css';

flushSync(() => createRoot(document.getElementById('root')!).render(<Dashboard />));
