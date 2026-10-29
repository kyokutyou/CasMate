import { expect, it } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { readOnlyEvent, readOnlySnapshot, speechRecognitionOverlayBootstrap } from '../src/main/server/local-view-projections';
import type { AppSettings } from '../src/shared/types';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

it('専用ビューだけへ専用外観を渡し、通常読取面へ専用設定を公開しない', () => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.settings.commentOverlay.fontSizePx = 22;
  snapshot.settings.speechRecognitionOverlay.fontSizePx = 66;
  expect(speechRecognitionOverlayBootstrap(snapshot).appearance.fontSizePx).toBe(66);
  expect(speechRecognitionOverlayBootstrap(snapshot).appearance).not.toHaveProperty('displayDurationSeconds');
  const projected = readOnlySnapshot(snapshot);
  expect(projected.settings).not.toHaveProperty('speechRecognitionOverlay');
  expect(readOnlyEvent({ type: 'settings.changed', payload: { section: 'speechRecognitionOverlay', value: snapshot.settings.speechRecognitionOverlay } })).toBeNull();
});

it('読取専用snapshotと状態イベントは配色を含めず、既存のアプリ設定と管理snapshotを保持する', () => {
  const snapshot = obsRegistrationSnapshot();
  const expected = { ...snapshot.settings.application };
  delete expected.managementTheme;
  delete expected.managementTextSize;
  expect(readOnlySnapshot(snapshot)).toMatchObject({ settings: { application: expected } });
  expect(readOnlySnapshot(snapshot)).not.toHaveProperty('settings.application.managementTheme');
  expect(readOnlyEvent({ type: 'state.snapshot', revision: 1, payload: snapshot })).not.toHaveProperty('payload.settings.application.managementTheme');
  expect(snapshot.settings.application.managementTheme).toBe('ocean');
  expect(readOnlySnapshot(snapshot)).not.toHaveProperty('settings.application.managementTextSize');
  expect(readOnlyEvent({ type:'state.snapshot', revision:1, payload:snapshot })).not.toHaveProperty('payload.settings.application.managementTextSize');
  expect(snapshot.settings.application.managementTextSize).toBe('medium');
});

it('読取専用のアプリ設定変更イベントは配色だけを除き、元の管理イベントを変更しない', () => {
  const value = { ...createDefaultSettings().application, port: 4000, managementTheme: 'pearl' as const, managementTextSize:'large' as const };
  const event = { type: 'settings.changed' as const, revision: 2, payload: { section: 'application', value } };
  const publicValue: AppSettings['application'] = { ...value };
  delete publicValue.managementTheme;
  delete publicValue.managementTextSize;
  expect(readOnlyEvent(event)).toEqual({ ...event, payload: { section: 'application', value: publicValue } });
  expect(event.payload.value.managementTheme).toBe('pearl');
  expect(event.payload.value.managementTextSize).toBe('large');
});
