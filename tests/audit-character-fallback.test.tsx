// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CharacterImage } from '../src/renderer/components/CharacterImage';
import { defaultCharacterSettings } from '../src/main/core/character-controller';

afterEach(cleanup);
it('閉口素材が読めなければ開口状態でもプレースホルダーを維持する', () => {
  const view = render(<CharacterImage mouthShape="open" settings={{ ...defaultCharacterSettings,
    simple: { ...defaultCharacterSettings.simple, closedAsset: '/assets/missing.png', openAsset: '/assets/open.png' } }} />);
  const images = [...view.container.querySelectorAll('img')];
  fireEvent.error(images[0]);
  expect(images.find(image => image.style.opacity === '1')?.getAttribute('src')).toBe('/placeholder.svg');
});
