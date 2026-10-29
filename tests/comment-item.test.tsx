// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommentItem } from '../src/renderer/components/CommentItem';
import type { CommonComment } from '../src/shared/types';
import { CharacterImage } from '../src/renderer/components/CharacterImage';

const rendererStyles = readFileSync(
  resolve('src/renderer/styles.css'),
  'utf8',
);

describe('CommentItem', () => {
  it('jpnknのサービス名・レス番号・本文を共通コメントとして表示する', () => {
    const comment: CommonComment = { id: 'jpnkn:board:123:2', externalId: 'board:123:2', source: 'jpnkn',
      authorName: 'レス2', content: [{ type: 'text', text: 'jpnknの本文' }], initialHistory: false,
      sequence: 2, receivedAt: new Date(0).toISOString() };
    const { container } = render(<CommentItem comment={comment} fields={{ showSource: true, showAuthor: true, showContent: true }} />);
    expect(screen.getByText('jpnkn')).toBeVisible(); expect(screen.getByText('レス2')).toBeVisible();
    expect(screen.getByText('jpnknの本文')).toBeVisible();
    expect(container.querySelector('.comment-jpnkn')).toBeInTheDocument();
  });
  it('任意HTMLを実行せずテキストとして表示し、公式エモートだけを画像化する', () => {
    const comment: CommonComment = {
      id: 'youtube:1', externalId: '1', source: 'youtube', authorName: '<b>投稿者</b>',
      content: [
        { type: 'text', text: '<script>window.hacked=true</script>' },
        { type: 'emote', id: 'wave', alt: ':wave:', url: 'https://example.test/emote.png' },
      ],
      initialHistory: false, sequence: 1, receivedAt: new Date(0).toISOString(),
    };
    const { container } = render(<CommentItem comment={comment} fields={{ showSource: true, showAuthor: true, showContent: true }} />);

    expect(screen.getByText('<b>投稿者</b>')).toBeInTheDocument();
    expect(screen.getByText('<script>window.hacked=true</script>')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: ':wave:' })).toHaveAttribute('src', 'https://example.test/emote.png');
    expect(container.querySelector('script')).toBeNull();
  });

  it('コメント一覧ではHTTP URLだけをクリック可能にし自動では開かない', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const comment: CommonComment = {
      id: 'twitch:2', externalId: '2', source: 'twitch', authorName: '投稿者',
      content: [{
        type: 'text',
        text: '参考 https://example.com/path?q=1。 javascript:alert(1)',
      }],
      initialHistory: false, sequence: 2, receivedAt: new Date(0).toISOString(),
    };

    render(<CommentItem
      comment={comment}
      fields={{ showSource: true, showAuthor: true, showContent: true }}
      linkifyUrls
    />);

    const link = screen.getByRole('link', { name: 'https://example.com/path?q=1' });
    expect(link).toHaveAttribute('href', 'https://example.com/path?q=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: /javascript:/ })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('先頭のhを省いたHTTP URLも補完してクリック可能にする', () => {
    const comment: CommonComment = {
      id: 'shitaraba:3', externalId: '3', source: 'shitaraba', authorName: '投稿者',
      content: [{
        type: 'text',
        text: '安全 ttps://example.com/secure と ttp://example.com/plain',
      }],
      initialHistory: false, sequence: 3, receivedAt: new Date(0).toISOString(),
    };

    render(<CommentItem
      comment={comment}
      fields={{ showSource: true, showAuthor: true, showContent: true }}
      linkifyUrls
    />);

    expect(screen.getByRole('link', { name: 'ttps://example.com/secure' }))
      .toHaveAttribute('href', 'https://example.com/secure');
    expect(screen.getByRole('link', { name: 'ttp://example.com/plain' }))
      .toHaveAttribute('href', 'http://example.com/plain');
  });
});

describe('CharacterImage', () => {
  it('閉口素材の読込失敗時はプレースホルダーへ戻す', () => {
    render(<CharacterImage settings={characterSettings('/closed.png')} alt="character" />);
    const image = screen.getByRole('img', { name: 'character' });
    expect(image).toHaveAttribute('src', '/closed.png');
    fireEvent.error(image);
    expect(image).toHaveAttribute('src', '/placeholder.svg');
  });

  it('閉口・口開き素材を同時に保持し、口形状態を不透明度で切り替える', () => {
    const settings = characterSettings('/closed.png', '/open.png');
    const { container, rerender } = render(<CharacterImage mouthShape="closed" settings={settings} alt="character" />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelector('img[src="/closed.png"]')).toHaveStyle({ opacity: '1' });
    expect(container.querySelector('img[src="/open.png"]')).toHaveStyle({ opacity: '0' });

    rerender(<CharacterImage mouthShape="open" settings={settings} alt="character" />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelector('img[src="/closed.png"]')).toHaveStyle({ opacity: '0' });
    expect(container.querySelector('img[src="/open.png"]')).toHaveStyle({ opacity: '1' });
  });

  it('口形切替に時間補間を入れず、閉口・口開き素材を瞬時に切り替える', () => {
    const characterRuleText = rendererStyles
      .match(/\.character-layers > img\s*\{[^}]*\}/)?.[0];
    expect(characterRuleText).toBeDefined();
    const style = document.createElement('style');
    style.textContent = characterRuleText ?? '';
    document.head.append(style);

    const { container } = render(<CharacterImage settings={characterSettings('/closed.png', '/open.png')} />);

    for (const image of container.querySelectorAll('img')) {
      expect(image.matches('.character-layers > img')).toBe(true);
    }
    const characterImageRule = [...(style.sheet?.cssRules ?? [])]
      .find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
        && rule.selectorText === '.character-layers > img');
    expect(characterImageRule).toBeDefined();
    expect(characterImageRule?.style.transition).toBe('');

    style.remove();
  });

  it('口開き素材がなくても閉口素材を2層へ配置する', () => {
    const { container } = render(<CharacterImage mouthShape="open" settings={characterSettings('/closed.png')} />);
    expect([...container.querySelectorAll('img')].map((image) => image.getAttribute('src')))
      .toEqual(['/closed.png', '/closed.png']);
    expect(container.querySelectorAll('img')[0]).toHaveStyle({ opacity: '0' });
    expect(container.querySelectorAll('img')[1]).toHaveStyle({ opacity: '1' });
  });

  it('共通開始時刻から3種類の微動を同じ位相で開始する', () => {
    const animations = Array.from({ length: 3 }, () => ({ currentTime: null as number | null, cancel: vi.fn() }));
    const animate = vi.fn()
      .mockReturnValueOnce(animations[0])
      .mockReturnValueOnce(animations[1])
      .mockReturnValueOnce(animations[2]);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_250);
    try {
      const { container } = render(<CharacterImage
        settings={characterSettings('/closed.png')}
        motionStartedAtMs={1_000}
      />);

      expect(container.querySelector('.character-safe-area > .character-motion-vertical > .character-motion-tilt > .character-motion-breathing > .character-layers')).not.toBeNull();
      expect(animate).toHaveBeenCalledTimes(3);
      expect(animations.map((animation) => animation.currentTime)).toEqual([1_250, 1_250, 1_250]);
    } finally {
      now.mockRestore();
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });
});

function characterSettings(closedAsset: string | null, openAsset: string | null = null) {
  return {
    mode: 'simple' as const,
    simple: {
      closedAsset,
      openAsset,
      motion: {
        enabled: true,
        verticalAmplitudePercent: 0.5,
        verticalPeriodSeconds: 3.6,
        tiltAmplitudeDegrees: 0.4,
        tiltPeriodSeconds: 5.2,
        breathingAmplitudePercent: 1,
        breathingPeriodSeconds: 3.2,
      },
    },
    alwaysOnTop: true,
    clickThrough: false,
    windowVisible: false,
    windowBounds: { width: 420, height: 520 },
    settingsWindowBounds: { width: 760, height: 760 },
  };
}
