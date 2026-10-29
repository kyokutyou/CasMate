import assert from 'node:assert/strict';

// Native wheel input is required: dispatchEvent cannot exercise Chromium's scroll chaining.
export async function verifyManagementCommentScroll({ evaluate, resize, wheel, capture }) {
  const settle = () => new Promise(resolve => setTimeout(resolve, 200));
  const comments = await evaluate('boardManagementHarness.snapshot().comments');
  let checks = 0;
  for (const [width, height] of [[320, 760], [760, 560]]) {
    await resize(width, height);
    for (const textSize of ['small', 'medium', 'large']) {
      for (const direction of [width === 320 ? 'newestBottom' : 'newestTop']) {
        await evaluate(`(() => {
          const snapshot = boardManagementHarness.snapshot();
          boardManagementHarness.updateSnapshot({settingsRevision:snapshot.settingsRevision+1,settings:{...snapshot.settings,
            application:{...snapshot.settings.application,managementTextSize:${JSON.stringify(textSize)}},
            commentList:{...snapshot.settings.commentList,stackDirection:${JSON.stringify(direction)}}}});
          document.querySelector('[data-page="live"]').click();
        })()`);
        await settle();
        // Force an outer scroll range, as with a short window or enlarged text.
        // The adopted live layout otherwise fits the viewport without outer scrolling.
        await evaluate("document.querySelector('.studio-live-layout').style.minHeight='900px'");
        const cases = [
          ['sparse-down', 2, 0, 120, 'body'], ['empty', 0, 0, 120, 'body'], ['sparse-up', 2, 0, -120, 'body'],
          ['top', comments.length, 0, -120, 'body'], ['bottom', comments.length, 1, 120, 'body'],
          ['read-up', comments.length, .5, -120, 'list'], ['read-down', comments.length, .5, 120, 'list'],
        ];
        for (const [name, length, fraction, delta, destination] of cases) {
          const label = `${width}x${height}/${textSize}/${direction}/${name}`;
          await evaluate(`boardManagementHarness.updateSnapshot({comments:${JSON.stringify(comments.slice(0, length))}})`);
          await settle();
          await evaluate(`(() => {
            const body = document.querySelector('.management-body'), list = document.querySelector('.studio-comment-stream');
            body.scrollTop = 120; list.scrollTop = (list.scrollHeight - list.clientHeight) * ${fraction};
          })()`);
          await settle();
          const before = await evaluate(`(() => {
            const body = document.querySelector('.management-body'), list = document.querySelector('.studio-comment-stream');
            const b = body.getBoundingClientRect(), l = list.getBoundingClientRect();
            const x = (l.left + l.right) / 2;
            const y = ${length <= 2} ? Math.min(b.bottom, l.bottom) - 16 : (Math.max(b.top, l.top) + Math.min(b.bottom, l.bottom)) / 2;
            return {body:body.scrollTop,list:list.scrollTop,overflow:list.scrollHeight>list.clientHeight,
              x,y,hit:document.elementFromPoint(x,y)?.closest('.studio-comment-stream') === list};
          })()`);
          assert.equal(before.hit, true, label + ' wheel targets the visible comment area');
          assert.equal(before.overflow, length > 2, label + ' comment scroll range');
          let after;
          // Fractional scroll limits and the compositor can consume the first tick at an edge.
          // Keep sending real input rather than changing scrollTop to simulate the wheel result.
          for (let tick = 0; tick < 3; tick++) {
            await wheel(before.x, before.y, delta);
            await settle();
            after = await evaluate(`(() => {
              const body = document.querySelector('.management-body'), list = document.querySelector('.studio-comment-stream');
              return {body:body.scrollTop,list:list.scrollTop};
            })()`);
            if ((after[destination] - before[destination]) * Math.sign(delta) > 20) break;
          }
          const moved = destination === 'body' ? after.body - before.body : after.list - before.list;
          assert.ok(moved * Math.sign(delta) > 20, `${label}: ${destination} must scroll with wheel; ${JSON.stringify({before,after})}`);
          const stationary = destination === 'body' ? 'list' : 'body';
          const drift = Math.abs(after[stationary] - before[stationary]);
          // Chromium can clamp the rounded DOM scroll maximum by one CSS pixel
          // when the compositor receives a wheel event at the bottom boundary.
          const stationaryWithinPixel = destination === 'body' && fraction === 1 ? drift <= 1 : drift < 1;
          assert.ok(stationaryWithinPixel, label + ': other scroll region stays still; ' + JSON.stringify({ before, after }));
          if (capture && textSize === 'large' && ['empty', 'sparse-down'].includes(name)) await capture(`comment-scroll-${name}-${width}.png`);
          checks++;
        }
      }
    }
  }
  return checks;
}
