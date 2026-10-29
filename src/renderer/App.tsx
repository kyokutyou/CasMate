import { Dashboard } from './pages/Dashboard';
import { CommentListPage } from './pages/CommentListPage';
import { CommentOverlayPage } from './pages/CommentOverlayPage';
import { CharacterPage } from './pages/CharacterPage';
import { MobileCommentsPage } from './pages/MobileCommentsPage';
import { SpeechRecognitionOverlayPage } from './pages/SpeechRecognitionOverlayPage';
import { TextEffectsOverlayPage } from './pages/TextEffectsOverlayPage';
import { SimpleCharacterSettingsPage } from './pages/SimpleCharacterSettingsPage';
import { ObsDesignPage } from './pages/ObsDesignPage';

export function App() {
  switch (location.pathname) {
    case '/obs/design':
      return <ObsDesignPage />;
    case '/comments':
      return document.querySelector('meta[name="casmate-mobile"]')
        ? <MobileCommentsPage />
        : <CommentListPage />;
    case '/overlay/comments':
      return <CommentOverlayPage />;
    case '/overlay/character':
      return <CharacterPage />;
    case '/overlay/speech-recognition':
      return <SpeechRecognitionOverlayPage />;
    case '/overlay/text-effects':
      return <TextEffectsOverlayPage />;
    case '/character/simple/settings':
      return <SimpleCharacterSettingsPage />;
    default:
      return <Dashboard />;
  }
}
