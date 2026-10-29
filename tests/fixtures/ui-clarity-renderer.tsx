import { createRoot } from 'react-dom/client';
import { Dashboard } from '../../src/renderer/pages/Dashboard';
import { CommentListPage } from '../../src/renderer/pages/CommentListPage';
import '../../src/renderer/styles.css';

createRoot(document.getElementById('root')!).render(document.querySelector('meta[name="ui-clarity-comments"]') ? <CommentListPage /> : <Dashboard />);
