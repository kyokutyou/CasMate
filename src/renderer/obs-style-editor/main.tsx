import './standalone.css';
import { createRoot } from 'react-dom/client';
import { ObsStyleEditorApp } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('OBS着せ替えツールの表示先がありません。');
createRoot(root).render(<ObsStyleEditorApp />);
