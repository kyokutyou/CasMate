// Character art and approved animation scenes, adopted 2026-11-12.
 const C={ink:'#332239',cream:'#fff9eb',gold:'#ffd449',pink:'#fb718b',teal:'#55d7cf',blue:'#74b9ed',purple:'#b195e9',peach:'#ffb541'};
 const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
 const lerp=(a,b,t)=>a+(b-a)*t;
 const range=(t,a,b)=>clamp((t-a)/(b-a));
 const ease=t=>1-Math.pow(1-clamp(t),3);
 const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
 const spring=t=>t<=0?0:1-Math.exp(-8*clamp(t))*Math.cos(13*clamp(t));
 function at(ctx,x,y,s,rotation,fn,alpha=1){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(s,s);ctx.globalAlpha*=clamp(alpha);fn();ctx.restore();}
 function ellipse(ctx,x,y,rx,ry,fill,stroke=C.ink,weight=3){ctx.beginPath();ctx.ellipse(x,y,Math.max(.001,Math.abs(rx)),Math.max(.001,Math.abs(ry)),0,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=weight;ctx.stroke();}}
 function path(ctx,fn,fill,stroke=C.ink,weight=3){ctx.beginPath();fn(ctx);ctx.closePath();ctx.lineJoin='round';if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=weight;ctx.stroke();}}
 function line(ctx,points,color=C.ink,weight=3){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=weight;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}
 function star(ctx,x,y,r,rotation=0,color=C.gold,alpha=1){at(ctx,x,y,1,rotation,()=>{ctx.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2;const d=i%2?r*.28:r;if(i){ctx.lineTo(Math.cos(a)*d,Math.sin(a)*d);}else{ctx.moveTo(Math.cos(a)*d,Math.sin(a)*d);}}ctx.closePath();ctx.lineJoin='round';ctx.strokeStyle=C.cream;ctx.lineWidth=7;ctx.stroke();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=C.ink;ctx.lineWidth=1.8;ctx.stroke();},alpha);}
 function heart(ctx,x,y,r,color=C.pink,rotation=0){at(ctx,x,y,r/20,rotation,()=>{ctx.beginPath();ctx.moveTo(0,15);ctx.bezierCurveTo(-32,-6,-15,-26,0,-12);ctx.bezierCurveTo(15,-26,32,-6,0,15);ctx.closePath();ctx.strokeStyle=C.cream;ctx.lineWidth=7;ctx.stroke();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=C.ink;ctx.lineWidth=2;ctx.stroke();});}
 const font='"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
 function text(ctx,word,x,y,size,color=C.pink,rotation=0){at(ctx,x,y,1,rotation,()=>{ctx.font=`900 ${size}px ${font}`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.lineJoin='round';ctx.miterLimit=2;ctx.strokeStyle=C.cream;ctx.lineWidth=14;ctx.strokeText(word,0,5);for(let i=6;i>=0;i-=2){ctx.strokeStyle=C.ink;ctx.lineWidth=7;ctx.strokeText(word,0,i);ctx.fillStyle=C.ink;ctx.fillText(word,0,i);}ctx.strokeStyle=C.ink;ctx.lineWidth=5;ctx.strokeText(word,0,0);const g=ctx.createLinearGradient(0,-size*.8,0,0);g.addColorStop(0,C.cream);g.addColorStop(.32,color);g.addColorStop(1,color);ctx.fillStyle=g;ctx.fillText(word,0,0);});}
 function burst(ctx,t,color=C.gold,x=0,y=0,r=170){const p=range(t,0,.9);if(t<=0||p>=1)return;at(ctx,x,y,ease(range(t,0,.35)),t*.15,()=>{ctx.globalAlpha*=.38*(1-p);path(ctx,()=>{for(let i=0;i<32;i++){const a=i/32*Math.PI*2;const d=i%2?r*.6:r;if(i){ctx.lineTo(Math.cos(a)*d,Math.sin(a)*d*.7);}else{ctx.moveTo(Math.cos(a)*d,Math.sin(a)*d*.7);}}},color,null);ellipse(ctx,0,0,r*(.5+p*.8),r*(.36+p*.6),null,color,4*(1-p)+.1);});}
 function confetti(ctx,t,seed=1,count=25){for(let i=0;i<count;i++){const delay=i%5*.03;const u=(t-delay)/2;if(u<=0||u>=1)continue;const a=i*2.39996+seed;const rr=(100+(i*47%150))*ease(u);const x=Math.cos(a)*rr;const y=Math.sin(a)*rr*.62+90*u*u;const alpha=Math.min(1,u*12)*(1-smooth(range(u,.4,1)));at(ctx,x,y,1,u*(i%2?4:-3),()=>{if(i%4===0)star(ctx,0,0,5+i%8,0,[C.gold,C.teal,C.pink][i%3]);else if(i%4===1)ellipse(ctx,0,0,3+i%3,3+i%3,null,C.teal,2);else{ctx.fillStyle=[C.pink,C.gold,C.teal,C.purple][i%4];ctx.fillRect(-3,-6,6,12);}},alpha);}}

const scenes=new Map();const H={C,clamp,lerp,range,ease,smooth,spring,at,ellipse,path,line,star,heart,text,burst,confetti};
const registry={H,register(scene){scenes.set(scene.id,scene);}};
(() => {
  const R = registry, H = R.H, C = H.C;

  const P = (t, a, b) => H.range(t, a, b);
  const pop = (t, a = 0, b = a + .5) => Math.max(.001, H.spring(P(t, a, b)));

  function sticker(ctx, draw, fill, weight = 3) {
    H.path(ctx, draw, fill, C.cream, weight + 8);
    H.path(ctx, draw, fill, C.ink, weight);
  }
  function caption(ctx, word, t, color, size = 55, delay = .5) {
    const u = P(t, delay, delay + .48);
    if (!u) return;
    H.at(ctx, 0, 154 + (1 - H.ease(u)) * 13, pop(t, delay, delay + .48), -.025 * (1 - u), () => H.text(ctx, word, 0, 0, size, color));
  }

  function check(ctx, x, y, t, delay, size = 1) {
    const u = P(t, delay, delay + .37);
    if (!u) return;
    H.at(ctx, x, y, size * pop(t, delay, delay + .45), -.12, () => {
      H.ellipse(ctx, 0, 0, 22, 22, '#d3f3c7', C.cream, 6);
      H.ellipse(ctx, 0, 0, 22, 22, null, '#57a274', 2);
      const points = u < .4 ? [[-11, 0], [H.lerp(-11, -3, u / .4), H.lerp(0, 9, u / .4)]]
        : [[-11, 0], [-3, 9], [H.lerp(-3, 13, (u - .4) / .6), H.lerp(9, -11, (u - .4) / .6)]];
      H.line(ctx, points, '#3f8d61', 5);
    });
  }
  function ghost(ctx, x, y, t, delay, flip) {
    const p = P(t, delay, delay + .6);
    if (!p) return;
    H.at(ctx, x + Math.sin(t * 3) * 7, y + Math.sin(t * 4) * 9, pop(t, delay, delay + .6), (flip ? -1 : 1) * .16, () => {
      sticker(ctx, () => {
        ctx.moveTo(-25, 27); ctx.lineTo(-25, -4); ctx.bezierCurveTo(-25, -44, 29, -42, 28, -3);
        ctx.lineTo(28, 28); ctx.quadraticCurveTo(16, 13, 8, 29); ctx.quadraticCurveTo(-1, 14, -9, 29); ctx.quadraticCurveTo(-17, 14, -25, 27);
      }, '#ddd4f5', 2);
      H.ellipse(ctx, -9, -7, 3, 7, '#70628c', null); H.ellipse(ctx, 10, -7, 3, 7, '#70628c', null);
      H.ellipse(ctx, 1, 10, 4, 5, '#8d79a9', null);
    }, .7 * p);
  }




  R.register({ id: 4, name: '困惑', duration: 4.2, draw(ctx, t) {
    const orbit = H.ease(P(t, .16, .7));
    H.at(ctx, 0, -28, orbit, -.13, () => {
      ctx.save(); ctx.globalAlpha *= .25;
      H.ellipse(ctx, 0, 0, 197, 96, null, C.purple, 2);
      H.ellipse(ctx, 0, 0, 169, 111, null, C.teal, 1.5); ctx.restore();
    });
    const tilt = Math.sin(Math.max(0, t - .35) * 3.2) * .13;
    H.at(ctx, 0, -29 + Math.sin(t * 3) * 2, pop(t, .06, .53), tilt, () => H.character(ctx, 0, 0, 218, 'puzzled', t));
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const phase = t * 1.7 + i * 1.3;
      const x = side * (170 + Math.sin(phase) * 15);
      const y = i < 2 ? -77 + Math.cos(phase) * 12 : 26 + Math.cos(phase) * 15;
      H.at(ctx, x, y, pop(t, .3 + i * .11, .87 + i * .11), Math.sin(t * 3 + i) * .16, () => H.text(ctx, '?', 0, 0, 55 + i % 2 * 7, [C.purple, C.teal, C.pink, C.gold][i]));
    }
    for (let i = 0; i < 3; i++) {
      const u = P(t, 1.3 + i * .12, 1.7 + i * .12);
      H.ellipse(ctx, 126 + i * 13, -112 - i * 9, (2.5 + i) * u, (2.5 + i) * u, C.cream, C.ink, 1.4);
    }
    caption(ctx, '困惑', t, C.purple, 55, .55);
  }});

  R.register({ id: 6, name: 'わかる', duration: 4.3, draw(ctx, t) {
    const nod = [.72, 1.38, 2.04].reduce((v, delay) => v + Math.sin(P(t, delay, delay + .5) * Math.PI), 0);
    ctx.save(); ctx.globalAlpha *= .13 * H.ease(P(t, .3, .9)); H.ellipse(ctx, 0, -20, 134, 104, '#bde6c6', null); ctx.restore();
    H.at(ctx, 0, -35 + nod * 13, pop(t, .06, .6), .052 * nod, () => H.character(ctx, 0, 0, 220, 'agree', t));
    for (let i = 0; i < 3; i++) {
      const u = P(t, .8 + i * .66, 1.2 + i * .66);
      if (u > 0 && u < 1) {
        ctx.save(); ctx.globalAlpha *= Math.sin(u * Math.PI);
        H.line(ctx, [[-126, 49 + u * 5], [-117, 58 + u * 9]], '#8ec49d', 3);
        H.line(ctx, [[121, 55 + u * 5], [133, 47 + u * 9]], '#8ec49d', 3); ctx.restore();
      }
    }
    check(ctx, -165, -30, t, 1.02, 1.05); check(ctx, 160, -67, t, 1.68, .9); check(ctx, 158, 30, t, 2.34, .75);
    H.at(ctx, -155, -107, pop(t, 1.03, 1.53), -.14, () => {
      sticker(ctx, () => {
        ctx.moveTo(-34, -15); ctx.quadraticCurveTo(-37, -28, -18, -28); ctx.lineTo(29, -28); ctx.quadraticCurveTo(44, -26, 42, -11);
        ctx.lineTo(40, 9); ctx.quadraticCurveTo(39, 23, 18, 20); ctx.lineTo(5, 21); ctx.lineTo(-3, 31); ctx.lineTo(-5, 19); ctx.lineTo(-23, 18); ctx.quadraticCurveTo(-38, 16, -34, -15);
      }, '#eff9df', 2);
      ctx.font = '700 24px "Yu Gothic", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#377851'; ctx.fillText('うん', 3, 5);
    });
    caption(ctx, 'わかる', t, '#78c98d', 55, .48);
  }});

  R.register({ id: 8, name: 'こわい…', duration: 4.2, draw(ctx, t) {
    const start = H.ease(P(t, .05, .48));
    ctx.save(); ctx.globalAlpha *= .14 * start; H.ellipse(ctx, 0, -22, 150, 117, C.purple, null); ctx.restore();
    ghost(ctx, -180, -64, t, .46, false); ghost(ctx, 181, -85, t, .75, true);
    const shiver = Math.sin(t * 58) * (2 + Math.sin(t * 9) ** 2 * 2) * P(t, .4, .8);
    H.at(ctx, shiver, -26 + Math.sin(t * 28) * 1.5, pop(t, .08, .61), Math.sin(t * 45) * .022, () => H.character(ctx, 0, 0, 224, 'scared', t));
    for (const side of [-1, 1]) {
      const shake = Math.sin(t * 12 + side) * 2;
      H.line(ctx, [[side * 133, -20], [side * (140 + shake), -8], [side * 134, 5], [side * (141 + shake), 18]], '#a491d3', 3);
    }
    for (let i = 0; i < 3; i++) {
      const u = P(t, .85 + i * .19, 2.1 + i * .23);
      if (!u || u >= 1) continue;
      H.at(ctx, -135 - i * 12, -46 + u * 91, .6 + i * .15, -.2, () => {
        sticker(ctx, () => {
          ctx.moveTo(0, -13); ctx.bezierCurveTo(-4, -6, -10, 3, -8, 8); ctx.bezierCurveTo(-4, 16, 9, 14, 9, 6); ctx.bezierCurveTo(8, 1, 2, -7, 0, -13);
        }, C.blue, 2);
      }, Math.sin(Math.PI * u));
    }
    caption(ctx, 'こわい…', t, C.purple, 52, .55);
  }});




})();

(() => {
  'use strict';
  const R = registry, H = R.H, C = H.C, TAU = Math.PI * 2;
  const P = (t, a, b) => H.range(t, a, b);
  const pop = (t, a, b) => Math.max(.001, H.spring(P(t, a, b)));

  function sticker(ctx, fn, fill, weight = 2.8) {
    ctx.beginPath(); fn(ctx); ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = C.cream; ctx.lineWidth = weight + 8; ctx.stroke();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = weight; ctx.stroke();
  }


  function label(ctx, word, t, delay, color = C.pink, size = 51, y = 151) {
    const u = P(t, delay, delay + .42); if (u <= 0) return;
    H.at(ctx, 0, y + (1 - H.ease(u)) * 16, H.spring(u), Math.sin(u * 13) * (1 - u) * .025, () => H.text(ctx, word, 0, 0, size, color));
  }
  function twinkles(ctx, t, positions, color = C.gold) {
    positions.forEach(([x, y, r], i) => {
      const u = P(t, .45 + i * .09, 1.15 + i * .09), s = H.spring(u) * (.82 + Math.sin(t * 3.5 + i * 2) * .18);
      H.star(ctx, x, y + Math.sin(t * 2 + i) * 4, r * Math.max(0, s), t * .18 + i, color, H.clamp(u * 8));
    });
  }













  function glove(ctx, x, y, angle = 0, scale = 1, flip = 1) {
    H.at(ctx, x, y, scale, angle, () => {
      ctx.scale(flip, 1);
      sticker(ctx, () => {
        ctx.moveTo(-14, 15); ctx.bezierCurveTo(-21, 6, -28, 1, -24, -4); ctx.bezierCurveTo(-20, -9, -14, 0, -12, 1);
        ctx.lineTo(-16, -20); ctx.bezierCurveTo(-17, -28, -8, -28, -6, -20); ctx.lineTo(-3, -10); ctx.lineTo(-4, -28);
        ctx.bezierCurveTo(-4, -35, 5, -35, 6, -26); ctx.lineTo(7, -10); ctx.lineTo(10, -24);
        ctx.bezierCurveTo(12, -31, 20, -27, 18, -20); ctx.lineTo(16, -4); ctx.lineTo(21, -14);
        ctx.bezierCurveTo(25, -20, 31, -13, 27, -7); ctx.lineTo(23, 9); ctx.bezierCurveTo(19, 25, 0, 27, -14, 15);
      }, '#fff0df', 2.5);
      H.line(ctx, [[-8, 6], [-2, 1], [6, 3]], '#d09f93', 1.6);
    });
  }
 R.register({ id: 19, name: 'セーフ！', duration: 4.3,
    draw(ctx, t) {
      const intro = pop(t, .01, .38), duck = Math.sin(P(t, .22, .95) * Math.PI), relief = H.ease(P(t, .94, 1.5)), fly = P(t, .12, .87);
      if (fly > 0 && fly < 1) {
        const x = H.lerp(-228, 228, H.smooth(fly)); ctx.save(); ctx.globalAlpha *= Math.min(1, fly * 12, (1 - fly) * 10);
        for (let i = 0; i < 3; i++) H.line(ctx, [[x - 35 - i * 9, -141 + i * 10], [x - 19, -141 + i * 10]], C.peach, 2 + i);
        H.at(ctx, x, -137, 1, t * 4, () => { sticker(ctx, () => { for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, r = 23 + Math.sin(i * 7) * 3; if(i){ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);}else{ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);} } }, '#beadc8', 2.4); H.line(ctx, [[-10, -7], [0, -13], [10, -5]], '#e8dceb', 3); }); ctx.restore();
      }
      H.at(ctx, -25, -25 + duck * 43 - relief * 3, intro, -.07 * duck + Math.sin(t * 3) * relief * .02, () => { ctx.scale(1 + duck * .07, 1 - duck * .1); H.character(ctx, 0, 0, 210, relief > .3 ? 'agree' : 'scared', t); });
      for (const side of [-1, 1]) { const u = H.ease(P(t, .92, 1.43)), x = side * (130 - u * 4) - 25, y = 24 + u * 24 + Math.sin(t * 4) * 2; glove(ctx, x, y, side * (.4 + u * .65), .66 * intro, side); }
      H.at(ctx, 158, -67, pop(t, 1.03, 1.6), -.1 + Math.sin(t * 2) * .025, () => {
        H.ellipse(ctx, 0, 0, 34, 34, '#9adebc', C.cream, 11); H.ellipse(ctx, 0, 0, 34, 34, '#9adebc', C.ink, 2.7); H.line(ctx, [[-17, 0], [-4, 13], [19, -15]], '#fffced', 10); H.line(ctx, [[-17, 0], [-4, 13], [19, -15]], '#33765c', 4.5);
      });
      const puff = P(t, 1.1, 2.38); if (puff > 0 && puff < 1) { ctx.save(); ctx.globalAlpha *= Math.sin(puff * Math.PI) * .85; H.ellipse(ctx, 102 + puff * 13, 33 - puff * 10, 8 + puff * 8, 6 + puff * 5, C.cream, '#b4d4ce', 1.6); H.ellipse(ctx, 122 + puff * 25, 25 - puff * 20, 12 + puff * 9, 9 + puff * 5, C.cream, '#b4d4ce', 1.6); ctx.restore(); }
      twinkles(ctx, t - .75, [[-210, -83, 10], [217, 34, 10]], C.teal);
      label(ctx, 'セーフ！', t, 1.2, C.teal, 54, 151);
    }
  });
})();

(() => {
  const R = registry, H = R.H, C = H.C;
  const pop = (t, a = 0, b = .6) => Math.max(.001, H.spring(H.range(t, a, b)));
  function rim(ctx, fill, draw, weight = 3) {
    ctx.beginPath(); draw(ctx); ctx.closePath(); ctx.lineJoin = 'round';
    ctx.strokeStyle = C.cream; ctx.lineWidth = 10; ctx.stroke(); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = weight; ctx.stroke();
  }

  function label(ctx, word, t, color = C.pink, size = 48) {
    H.at(ctx, 0, 151 + (1 - H.ease(H.range(t, .3, .7))) * 13, pop(t, .3, .82), -.018, () => H.text(ctx, word, 0, 0, size, color));
  }
  function steam(ctx, x, y, t, color = '#c8a5bb', count = 3, height = 55) {
    if (t <= 0) return;
    for (let i = 0; i < count; i++) {
      const p = (t * .55 + i / count) % 1;
      H.at(ctx, x + (i - (count - 1) / 2) * 16, y - p * height, 1, 0, () => {
        ctx.beginPath(); ctx.moveTo(0, 10); ctx.bezierCurveTo(-13, 0, 13, -8, 0, -25);
        ctx.lineCap = 'round'; ctx.strokeStyle = C.cream; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
      }, Math.sin(p * Math.PI) * .7);
    }
  }
  function tinySparkles(ctx, t, color = C.gold, seed = 0) {
    if (t <= 0) return;
    for (let i = 0; i < 7; i++) {
      const p = (t * .48 + i * .19 + seed) % 1, a = i * 2.4 + seed;
      const alpha = Math.sin(p * Math.PI) * H.range(t, .3, .65);
      H.star(ctx, Math.cos(a) * (190 + i % 3 * 14), Math.sin(a) * 104 - 18 - p * 14,
        (4 + i % 3 * 2) * alpha, p * .7, color, alpha);
    }
  }



  R.register({ id: 23, name: 'おつかれさま', duration: 4.6, draw(ctx, t) {
    H.at(ctx, 0, (1 - H.ease(H.range(t, .05, .7))) * 36, pop(t, .05, .72), 0, () => {
      H.ellipse(ctx, 18, 88, 183, 10, '#eadcea', null);
      H.character(ctx, -80, -24 + Math.sin(t * 3) * 2, 207, 'rest', t, -.065 + Math.sin(t * 2.4) * .025);
      H.at(ctx, 97, 10, .91, Math.sin(t * 2) * .02, () => {
        H.ellipse(ctx, 101, 10, 27, 31, C.cream, C.ink, 3.5);
        H.ellipse(ctx, 102, 10, 14, 18, '#efdeed', C.ink, 2.5);
        const g = ctx.createLinearGradient(-4, -42, 90, 65); g.addColorStop(0, '#a0eee1'); g.addColorStop(1, '#5eb9b5');
        rim(ctx, g, c => { c.moveTo(-4, -34); c.lineTo(85, -34); c.lineTo(79, 47); c.bezierCurveTo(77, 75, 2, 75, -2, 47); });
        H.ellipse(ctx, 41, -34, 44, 12, '#d3f5e9', C.ink, 3);
        H.ellipse(ctx, 41, -35, 34, 7, '#8e5a47', null);
        H.line(ctx, [[8, -17], [7, 32], [13, 47]], '#e3fff2', 4);
        H.heart(ctx, 43, 18, 15, '#fff1bd');
        steam(ctx, 39, -56, t - .28, '#c5a2b6', 3, 52);
      });
      for (let i = 0; i < 3; i++) {
        const p = (t * .3 + i / 3) % 1;
        H.at(ctx, 0, 0, 1, 0, () => H.heart(ctx, -172 - p * 18 + i * 12, -26 - p * 80, 5 + i * 2, C.pink, -.2 + i * .1), Math.sin(p * Math.PI));
      }
    });
    label(ctx, 'おつかれさま', t, '#bd9ade', 45);
  } });

  function toastGlass(ctx, t, color) {
    const g = ctx.createLinearGradient(-30, -57, 29, 53); g.addColorStop(0, '#fff9df'); g.addColorStop(.18, '#fff5c8'); g.addColorStop(1, '#f4cf7c');
    rim(ctx, g, c => { c.moveTo(-34, -59); c.lineTo(34, -59); c.lineTo(28, 55); c.bezierCurveTo(26, 68, -26, 68, -28, 55); }, 3);
    ctx.save(); ctx.beginPath(); ctx.moveTo(-30, -52); ctx.lineTo(30, -52); ctx.lineTo(24, 53); ctx.quadraticCurveTo(0, 63, -24, 53); ctx.closePath(); ctx.clip();
    const beer = ctx.createLinearGradient(0, -45, 0, 60); beer.addColorStop(0, '#ffd668'); beer.addColorStop(1, color);
    ctx.beginPath(); ctx.moveTo(-35, -33);
    for (let i = 0; i <= 12; i++) ctx.lineTo(-35 + i * 6, -33 + Math.sin(i * .6 + t * 9) * (2 + 2 * Math.exp(-Math.max(0, t - .7) * 3)));
    ctx.lineTo(35, 70); ctx.lineTo(-35, 70); ctx.closePath(); ctx.fillStyle = beer; ctx.fill();
    for (let i = 0; i < 9; i++) { const p = (t * .5 + i * .153) % 1; H.ellipse(ctx, -19 + (i * 13 % 41), 55 - p * 83, 1.5 + i % 2, 2 + i % 2, '#fff6c2', null); }
    ctx.restore();
    for (let i = 0; i < 5; i++) H.ellipse(ctx, -25 + i * 12, -36 + Math.sin(i + t * 3) * 2, 10, 8, '#fff9e9', null);
    H.line(ctx, [[-22, -16], [-20, 43]], '#fffbed', 4); H.line(ctx, [[23, -8], [21, 26]], '#ffedac', 2);
    H.ellipse(ctx, 0, -59, 34, 7, '#fff3d2', C.ink, 2.5);
  }

  R.register({ id: 25, name: '乾杯！', duration: 4.4, draw(ctx, t) {
    const approach = H.ease(H.range(t, .12, .8)), relax = H.smooth(H.range(t, .95, 1.55));
    const distance = H.lerp(188, 28, approach) + relax * 144;
    const lift = H.lerp(0, -122, approach) + relax * 122;
    H.at(ctx, 0, 0, pop(t, .03, .62), 0, () => {
      H.character(ctx, 0, -3 - Math.sin(Math.max(0, t - .8) * 7) * 2.5, 196, t < .85 ? 'agree' : 'laugh', t, Math.sin(t * 3) * .035);
    });
    if (t > .76) H.burst(ctx, t - .76, C.gold, 0, -125, 100);
    for (const s of [-1, 1]) {
      H.at(ctx, s * distance, lift + Math.sin(t * 3) * 1.6, pop(t, 0, .5) * .64, -s * (.19 * approach - .12 * relax), () => {
        H.ellipse(ctx, 0, 75, 33, 7, '#fff0cf', C.ink, 2.5); toastGlass(ctx, t, s < 0 ? '#f5b63a' : '#eaa437');
      });
    }
    const u = H.range(t, .8, 1.7);
    if (u > 0 && u < 1) {
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI + i / 11 * Math.PI, r = 10 + H.ease(u) * (46 + i % 3 * 10);
        H.ellipse(ctx, Math.cos(a) * r, -127 + Math.sin(a) * r * .5 + u * u * 34, 2 + i % 3, 2.5 + i % 3, '#ffd66b', C.cream, 1.5);
      }
      H.star(ctx, 0, -132, 17 * Math.sin(Math.PI * u), -.15, C.gold);
    }
    tinySparkles(ctx, t - .4, C.gold, .2); label(ctx, '乾杯！', t, '#f1af48', 55);
  } });



  R.register({ id: 28, name: 'ひと休みしよ', duration: 4.8, draw(ctx, t) {
    const settle = H.smooth(H.range(t, .45, 1.6));
    H.at(ctx, 0, 5 + (1 - H.ease(H.range(t, 0, .6))) * 55, pop(t, 0, .65), 0, () => {
      H.ellipse(ctx, 0, 91, 169, 9, '#ded9ea', null);
      H.line(ctx, [[-148, -62], [-82, 69], [90, 69], [165, -4]], C.cream, 15);
      H.line(ctx, [[-148, -62], [-82, 69], [90, 69], [165, -4]], C.ink, 7);
      H.line(ctx, [[-146, -62], [-80, 67], [90, 67], [165, -3]], '#c69877', 4);
      H.line(ctx, [[-80, 67], [-99, 88]], C.ink, 6); H.line(ctx, [[90, 67], [108, 88]], C.ink, 6);
      rim(ctx, '#b79bcf', c => { c.moveTo(-150, -71); c.quadraticCurveTo(-130, -75, -119, -56); c.lineTo(-64, 34); c.quadraticCurveTo(30, 53, 137, -4); c.lineTo(151, 7); c.bezierCurveTo(45, 80, -23, 80, -86, 51); });
      H.at(ctx, -39, 18, 1, -.22, () => H.ellipse(ctx, -51, -24, 61, 27, '#e4d3ee', C.ink, 2.5));
      // The head settles into a pillow; a purple blanket replaces the old yellow torso.
      H.character(ctx, -43 - settle * 7, -37 + settle * 10 + Math.sin(t * 2.6) * 1.5, 188, 'rest', t, -.13 - settle * .12);
      rim(ctx, '#d2b9e4', c => { c.moveTo(-42, 42); c.quadraticCurveTo(30, 20, 105, 27); c.quadraticCurveTo(124, 42, 103, 55); c.quadraticCurveTo(38, 80, -42, 60); }, 2.5);
      H.line(ctx, [[-17, 48], [24, 41], [65, 44]], '#eadbf3', 3);
      for (let i = 0; i < 3; i++) {
        const p = (Math.max(0, t - .9) * .35 + i / 3) % 1, alpha = Math.sin(p * Math.PI) * H.range(t, .85, 1.3);
        H.at(ctx, 116 + p * 40, -43 - p * 78, .65 + p * .45, .12, () => H.text(ctx, 'z', 0, 0, 23, C.purple), alpha);
      }
      H.star(ctx, -186, -26, 7 + Math.sin(t * 3) * 2, -.3, C.gold, .8 * H.range(t, .4, .9));
    });
    label(ctx, 'ひと休みしよ', t, '#b59bd9', 45);
  } });



})();

(() => {
 const R=registry,H=R.H,C=H.C;
 R.register({id:20,name:'危ない！',duration:4.1,draw(ctx,t){
  const pop=H.spring(H.range(t,.06,.63));
  H.burst(ctx,t-.3,C.gold,70,-20,182);
  const shake=Math.sin(t*45)*2.5*H.range(t,.35,.65)*(1-H.range(t,2.2,3.2));
  H.at(ctx,-103+shake,-30,pop,-.055+Math.sin(t*8)*.025,()=>H.character(ctx,0,0,226,'surprise',t));
  H.at(ctx,129,-16,H.spring(H.range(t,.26,.77)),Math.sin(t*24)*.055*Math.exp(-Math.max(0,t-.75)*3),()=>{
   H.path(ctx,()=>{ctx.moveTo(0,-84);ctx.lineTo(87,65);ctx.quadraticCurveTo(92,77,79,77);ctx.lineTo(-79,77);ctx.quadraticCurveTo(-92,77,-87,65);},C.gold,C.cream,12);
   H.path(ctx,()=>{ctx.moveTo(0,-84);ctx.lineTo(87,65);ctx.quadraticCurveTo(92,77,79,77);ctx.lineTo(-79,77);ctx.quadraticCurveTo(-92,77,-87,65);},null,C.ink,3.5);
   H.line(ctx,[[-5,-61],[-64,56]],'#fff2b9',6);
   H.at(ctx,0,12,H.spring(H.range(t,.48,.9)),0,()=>{ctx.fillStyle=C.ink;ctx.beginPath();ctx.roundRect(-9,-46,18,60,7);ctx.fill();H.ellipse(ctx,0,34,10,10,C.ink,null);});
  });
  for(const side of [-1,1])for(let i=0;i<3;i++){const u=H.range(t,.35+i*.1,.7+i*.1);H.line(ctx,[[129+side*101,-53+i*43],[129+side*(101+u*19),-53+i*43-4]],C.pink,3.4);}
  for(let i=0;i<3;i++){const u=H.range(t,.75+i*.15,1.5+i*.2);if(u>0&&u<1){ctx.save();ctx.globalAlpha*=Math.sin(u*Math.PI);H.ellipse(ctx,-227-i*7,-37+u*76,3+i,7+i,C.blue,C.cream,2);ctx.restore();}}
  H.at(ctx,0,154,H.spring(H.range(t,.55,1.05)),0,()=>H.text(ctx,'危ない！',0,0,54,C.pink));
 }});
})();

export {scenes,H};
