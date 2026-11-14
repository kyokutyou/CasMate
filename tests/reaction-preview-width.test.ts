// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {setupPreviewWidth} from '../src/renderer/reactions/client/preview-width.mjs';
afterEach(()=>{document.body.replaceChildren();document.body.className='';});
it('toggles width without replacing the preview and cancels an active placement',()=>{
  document.body.innerHTML=new DOMParser().parseFromString(readFileSync('listener-reactions.html','utf8'),'text/html').body.innerHTML;
  const stage=document.querySelector('#screen-stage'),button=document.querySelector<HTMLButtonElement>('#preview-width-toggle')!;
  const cancel=vi.fn();setupPreviewWidth(cancel);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  button.click();expect(document.body.classList.contains('preview-wide')).toBe(true);
  expect(button.textContent).toBe('通常の幅に戻す');expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('#screen-stage')).toBe(stage);expect(document.activeElement).toBe(button);
  button.click();expect(document.body.classList.contains('preview-wide')).toBe(false);
  expect(button.textContent).toBe('横幅いっぱい');expect(cancel).toHaveBeenCalledTimes(2);
});
