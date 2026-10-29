import assert from 'node:assert/strict';

export async function verifyManagementPageHeadings({evaluate,resize,capture,setZoom,resizeMinimum}) {
  const settle=()=>evaluate('new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))})');
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settle();};
  const initial=await evaluate('boardManagementHarness.snapshot()');
  const pages=[['home','配信のホーム'],['settings','設定']];
  let count=0;
  for(const theme of ['ocean','pearl'])for(const [size,font,title] of [['small',17,24],['medium',19,28],['large',21,32]]) {
    await evaluate(`(() => {const snapshot=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:snapshot.settingsRevision+1,settings:{...snapshot.settings,application:{...snapshot.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:${JSON.stringify(size)}}}});})()`);
    for(const [width,height] of [[1200,820],[1101,820],[1100,820],[760,560],[621,760],[620,760],[560,760],[480,760],[420,760],[320,760]]) {
      await resize(width,height);await settle();
      for(const [page,label] of pages) {
        await click(`[data-page="${page}"]`);
        const result=await evaluate(`(() => {const h=document.getElementById('page-heading'),group=h.parentElement,style=getComputedStyle(h),r=h.getBoundingClientRect(),body=document.querySelector('.management-body'),b=body.getBoundingClientRect();return {label:h.textContent,font:parseFloat(style.fontSize),description:Boolean(group.querySelector('p')),focused:document.activeElement===h,gap:parseFloat(getComputedStyle(group).marginBottom),inside:r.left>=b.left&&r.right<=b.right,overflow:document.documentElement.scrollWidth>innerWidth||body.scrollWidth>body.clientWidth}})()`);
        assert.deepEqual(result,{label,font,description:false,focused:true,gap:12,inside:true,overflow:false},`${theme}/${size}/${width}/${page}`);
        if(page==='home') {
          const layout=await evaluate(`(() => {const home=document.querySelector('.management-home'),card=home.querySelector('.studio-obs-application'),status=card.querySelector('.studio-integration-status'),links=card.querySelector('.management-shortcuts'),h=home.getBoundingClientRect(),c=card.getBoundingClientRect(),s=status.getBoundingClientRect(),l=links.getBoundingClientRect();return {width:innerWidth,full:Math.abs(c.width-h.width)<2,sideBySide:s.right<=l.left&&s.top<l.bottom&&l.top<s.bottom,stacked:s.bottom<=l.top,inside:s.left>=c.left&&l.right<=c.right,overflow:card.scrollWidth>card.clientWidth}})()`);
          const twoColumns=layout.width>=621&&layout.width<=1100;
          assert.equal(layout.full,layout.width<=1100,'OBS card fills the row at two/one columns');
          assert.equal(layout.sideBySide,twoColumns,'OBS state and settings share a row only at two columns');
          assert.equal(layout.stacked,!twoColumns,'wide and narrow cards keep vertical reading order');
          assert.equal(layout.inside&&!layout.overflow,true,'OBS state and links fit the card');
          if(capture&&size==='medium'&&width===760) {
            await evaluate(`document.querySelector('.studio-obs-application').scrollIntoView({block:'center'})`);await settle();
            await capture(`home-obs-${theme}.png`);
          }
        }
        if(capture&&size==='medium'&&width===760)await capture(`page-heading-${theme}-${page}.png`);
        count++;
      }
    }
    await click('[data-page="live"]');
    assert.equal(await evaluate('document.querySelector(".management-page-heading").getBoundingClientRect().height<=1'),true,'live heading stays visually omitted');count++;
    await resize(760,560);await click('[data-page="home"]');await click('#home-commentSpeech');
    assert.deepEqual(await evaluate(`({title:parseFloat(getComputedStyle(document.getElementById('editor-heading')).fontSize),explanation:Boolean(document.querySelector('.editor-introduction p'))})`),{title,explanation:true},'feature editor keeps its heading and explanation');
    await click('.editor-heading-row .back-button');
    assert.equal(await evaluate('document.activeElement.id'),'home-commentSpeech','editor return focus');count++;
  }
  if(setZoom)await setZoom(1.5);
  if(resizeMinimum)await resizeMinimum();else await resize(203,215);
  for(const [page] of pages) {
    await click(`[data-page="${page}"]`);
    assert.equal(await evaluate(`(() => {const body=document.querySelector('.management-body');return document.documentElement.scrollWidth<=innerWidth&&body.scrollWidth<=body.clientWidth&&document.activeElement.id==='page-heading'})()`),true,'native minimum/zoom heading stays reachable');count++;
  }
  assert.equal(await evaluate('boardManagementHarness.trace().length'),0,'page navigation makes no operation requests');
  if(setZoom)await setZoom(1);
  await evaluate(`boardManagementHarness.updateSnapshot(${JSON.stringify(initial)})`);
  return count;
}
