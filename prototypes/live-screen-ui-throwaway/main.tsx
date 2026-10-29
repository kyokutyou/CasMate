// Three throwaway variants of the existing live page, selected by ?variant=A|B|C.
import { createRoot } from 'react-dom/client';
import { LivePrototype } from './prototype';
import '../../src/renderer/styles.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<LivePrototype />);
