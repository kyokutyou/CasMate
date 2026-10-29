import { useApplicationState } from '../api';
import { CharacterImage } from '../components/CharacterImage';
import { useTransparentDocument } from '../use-transparent-document';
import { useObsDisplayTest } from '../use-obs-display-test';

export function CharacterPage() {
  useTransparentDocument();
  const { snapshot, reportCharacterAssetError } = useApplicationState();
  const test = useObsDisplayTest('character', new URLSearchParams(location.search).get('presentation') !== 'standalone');
  if (!snapshot) return null;
  const appearance = test?.data.kind === 'character' ? test.data.appearance : null;
  return <main className="character-page"><CharacterImage
    mouthShape={appearance ? appearance.openAsset && Math.floor(test!.elapsed / 200) % 2 ? 'open' : 'closed' : snapshot.character.mouthShape}
    settings={appearance ? { ...snapshot.settings.character, simple: appearance } : snapshot.settings.character}
    motion={appearance?.motion ?? snapshot.character.motion} motionStartedAtMs={appearance ? test!.startedAt : snapshot.character.motionStartedAtMs}
    onOpenAssetError={appearance ? undefined : reportCharacterAssetError} /></main>;
}
