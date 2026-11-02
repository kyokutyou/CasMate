import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';

app.disableHardwareAcceleration();
app.setPath('userData', process.argv[3]);
app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { backgroundThrottling: false, spellcheck: false } });
try {
  await window.loadFile(process.argv[2]);
  await window.webContents.executeJavaScript(`document.fonts.ready`);
  for (const font of ['Yu Gothic UI', 'Meiryo', 'Arial']) for (const size of [16, 32, 70]) for (const gap of [0, 12]) for (const lineHeight of [1, 1.5, 3]) {
    const result = await window.webContents.executeJavaScript(`(() => {
      const main=document.querySelector('main');
      main.innerHTML='<div class="overlay-comment"><article class="comment"><div class="comment-meta"><strong>見本のリスナーAg</strong></div><div class="comment-body"><span>配信を楽しんでいます！Ag<br>二行目の本文です</span></div></article></div>';
      main.style.cssText='--cm-font:'+${JSON.stringify(JSON.stringify(font))}+';--cm-size:${size}px;--cm-meta-gap:${gap}px;--cm-line-height:${lineHeight};--cm-tilt:0deg;--cm-author-color:rgb(255,0,0);--cm-text:rgb(0,255,0);--cm-text-shadow:none;--cm-outline:none;--cm-background:rgb(0,0,0);--cm-border:none;--cm-card-shadow:none;--cm-edge:12px';
      if(${font === 'Yu Gothic UI' && size === 32 && gap === 0 && lineHeight === 3}) {
        main.querySelector('.overlay-comment').style.width='180px';
        main.querySelector('strong').textContent='投稿者の名前が複数行に折り返されます';
        main.querySelector('.comment-body').innerHTML='<span>本文Ag<br>二行目</span>';
      }
      const body=main.querySelector('.comment-body'),meta=main.querySelector('.comment-meta');
      const before=body.offsetHeight;
      CommentInkGap.updateCommentInkGap(main);
      return {before,after:body.offsetHeight,trim:parseFloat(meta.style.getPropertyValue('--cm-ink-gap-trim')),margin:parseFloat(getComputedStyle(meta).marginBottom)};
    })()`);
    assert.equal(result.before, result.after, 'body line spacing remains unchanged');
    assert.ok(Number.isFinite(result.trim), JSON.stringify({ font, size, gap, lineHeight, result }));
    assert.ok(Math.abs(result.margin + result.trim - gap) < 0.01);
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const image = await window.webContents.capturePage();
    const pixels = image.toBitmap();
    const width = image.getSize().width;
    const red = [], green = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const y = Math.floor(index / 4 / width);
      if (pixels[index + 2] > 80 && pixels[index + 1] < 20 && pixels[index] < 20) red.push(y);
      if (pixels[index + 1] > 80 && pixels[index + 2] < 20 && pixels[index] < 20) green.push(y);
    }
    assert.ok(red.length && green.length, 'colored glyphs are painted');
    const deviceScale=await window.webContents.executeJavaScript('devicePixelRatio');
    const actual = (Math.min(...green) - Math.max(...red) - 1)/deviceScale;
    assert.ok(Math.abs(actual - gap) <= 2, `visible glyph gap: ${JSON.stringify({font,size,gap,lineHeight,actual,result})}`);
  }
  const special = await window.webContents.executeJavaScript(`(() => {
    const main=document.querySelector('main'),meta=main.querySelector('.comment-meta'),body=main.querySelector('.comment-body');
    main.style.setProperty('--cm-size','32px');main.style.setProperty('--cm-meta-gap','0px');
    meta.innerHTML='<span class="source-badge" style="background:rgb(255,0,0)">サービス</span>';
    body.innerHTML='<img class="emote" style="width:60px;height:60px" alt="見本"><span>本文</span>';
    CommentInkGap.updateCommentInkGap(main);
    const badgeBottom=meta.querySelector('span').getBoundingClientRect().bottom;
    const imageTop=body.querySelector('img').getBoundingClientRect().top;
    const emoteGap=imageTop-badgeBottom;
    body.innerHTML='<span>\\n\\n本文</span>';
    const height=body.offsetHeight;CommentInkGap.updateCommentInkGap(main);
    const blankLinesPreserved=height===body.offsetHeight;
    meta.style.display='none';CommentInkGap.updateCommentInkGap(main);
    const hidden=!meta.style.getPropertyValue('--cm-ink-gap-trim');
    meta.style.display='';main.style.transform='scale(.25)';
    body.innerHTML='<span>本文</span>';CommentInkGap.updateCommentInkGap(main);
    const scaled=parseFloat(meta.style.getPropertyValue('--cm-ink-gap-trim'));
    main.style.transform='';CommentInkGap.updateCommentInkGap(main);
    return {emoteGap,blankLinesPreserved,hidden,scaled,normal:parseFloat(meta.style.getPropertyValue('--cm-ink-gap-trim'))};
  })()`);
  assert.ok(Math.abs(special.emoteGap) < 1, 'painted badge and emote do not overlap: '+JSON.stringify(special));
  assert.equal(special.blankLinesPreserved, true);
  assert.equal(special.hidden, true);
  assert.ok(Math.abs(special.scaled-special.normal) < 1, 'thumbnail scale does not change the trim');
  for (const prefix of ['', '<span></span>', '<span> </span>']) {
    const leadingEmote = await window.webContents.executeJavaScript(`(() => {
    const main=document.querySelector('main'),meta=main.querySelector('.comment-meta'),body=main.querySelector('.comment-body');
    main.style.setProperty('--cm-line-height','3');
    body.innerHTML=${JSON.stringify(prefix)}+'<img class="emote" style="width:16px;height:16px" alt="見本"><span>\\n本文</span>';
    CommentInkGap.updateCommentInkGap(main);
    return body.querySelector('img').getBoundingClientRect().top-meta.querySelector('.source-badge').getBoundingClientRect().bottom;
  })()`);
    assert.ok(Math.abs(leadingEmote) < 1, 'first-line emote before a newline is not a blank line: '+JSON.stringify({prefix,leadingEmote}));
  }
  console.log('PASS: comment ink gap');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { window.destroy(); app.quit(); }
});
