// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InitialSetupEntry } from '../src/renderer/components/InitialSetupEntry';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import type { InitialSetupView } from '../src/shared/initial-setup';

afterEach(cleanup);
function fixture() {
  const snapshot = obsRegistrationSnapshot();
  const view: InitialSetupView = { ...new InitialSetupStore('unused', false).view(snapshot), started:true, position:'summary', selected:['sources'] };
  return { snapshot, view, pending:false, perform:vi.fn(async () => true), currentStatus:() => '停止中' };
}
it('別画面で最後の項目が確認済みになっても、操作中の結果ボタンと行き先を保持する', () => {
  const props = fixture();
  const { rerender } = render(<InitialSetupEntry {...props}/>);
  const action = screen.getByRole('button', { name:'この項目を確認する →' });
  act(() => action.focus());
  rerender(<InitialSetupEntry {...props} view={{...props.view,confirmations:{sources:props.view.fingerprints.sources}}}/>);
  expect(action).toHaveFocus();
  expect(screen.getByRole('heading',{name:'ホームで状態を確認'})).toBeVisible();
  fireEvent.click(action);
  expect(props.perform).toHaveBeenCalledWith({action:'move',position:'sources'});
});
it('実状態の更新で優先項目が変わっても、フォーカス中の操作対象を差し替えない', () => {
  const props=fixture(); props.view.selected=['sources','commentSpeech'];
  const {rerender}=render(<InitialSetupEntry {...props}/>);
  const action=screen.getByRole('button',{name:'この項目を確認する →'});
  act(()=>action.focus());
  const snapshot={...props.snapshot,settings:{...props.snapshot.settings,sources:{...props.snapshot.settings.sources,youtube:{...props.snapshot.settings.sources.youtube,target:'@caster'}}}};
  rerender(<InitialSetupEntry {...props} snapshot={snapshot}/>);
  fireEvent.click(action);
  expect(props.perform).toHaveBeenCalledWith({action:'move',position:'sources'});
  act(()=>document.getElementById('setup-result-sources')!.focus());
  expect(screen.getByRole('button',{name:'この項目を確認する →'})).toHaveAttribute('data-step','commentSpeech');
});
