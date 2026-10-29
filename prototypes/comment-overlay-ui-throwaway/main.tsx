import { createRoot } from 'react-dom/client';
import { Prototype } from './prototype';
import '../../src/renderer/styles.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<Prototype />);
