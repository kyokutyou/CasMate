import {H} from './scenes.mjs';
let buffer;
export function drawSurprise(ctx,time){const width=736,height=414;const characterNormal=H.image('motion-normal'),characterSurprise=H.image('motion-surprise');
  const DURATION = 3.8;
  const settings = { size: 1, speed: 1, particles: true, accent: '#ce82b4' };
  const colors = { ink: '#332239', cream: '#fff9eb', blush: '#f98d81', peach: '#ffb541', light: '#fff5b7', gold: '#ffd449', teal: '#55d7cf', deep: '#71426c' };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
  const out = t => 1 - Math.pow(1 - clamp(t), 3);
  const spring = t => t <= 0 ? 0 : 1 - Math.exp(-9 * t) * Math.cos(15 * t);
  const range = (t, a, b) => clamp((t - a) / (b - a));
  const wave=(t,a,b)=>Math.sin(range(t,a,b)*Math.PI);
  const TAU = Math.PI * 2;
  const font = '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

  function ellipse(x, y, rx, ry, fill, stroke, weight = 3) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(.001, rx), Math.max(.001, ry), 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = weight; ctx.stroke(); }
  }

  function line(points, color, weight = 3) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function star(x, y, radius, rotation = 0, color = colors.gold, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.globalAlpha *= alpha;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 - Math.PI / 2;
      const r = i % 2 ? radius * .27 : radius;
      if(i){ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);}else{ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);}
    }
    ctx.closePath();
    ctx.strokeStyle = colors.cream; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore();
  }

  function glow(x, y, radius, color, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    ellipse(x, y, radius, radius, g); ctx.restore();
  }

  function cloud(t) {
    const p = range(t, .23, .7);
    if (p <= 0) return;
    const entry = out(p);
    const fade = 1 - range(t, .65, 1.6);
    if (fade <= 0) return;
    ctx.save(); ctx.globalAlpha *= fade * .45;
    const count = 22;
    for (let i = 0; i < count; i++) {
      const a = i / count * TAU + .17;
      const r = lerp(58, 145, entry) + Math.sin(i * 2.4) * 15;
      ellipse(Math.cos(a) * r, Math.sin(a) * r * .76, 16 + i % 3 * 7, 13 + i % 4 * 4, i % 2 ? '#ffe8c3' : '#fbd5b8');
    }
    ctx.restore();
  }

  function impact(t) {
    const p = range(t, .23, .9);
    if (p <= 0 || p >= 1) return;
    ctx.save(); ctx.globalAlpha *= Math.pow(1 - p, 1.35);
    ctx.translate(-8, 5); ctx.rotate(-.08);
    ctx.beginPath();
    const radii = [1, .7, .95, .64, 1, .8, .93, .62, 1.1, .7, .9, .68, 1.05, .7, .94, .6, 1.1, .72, 1, .65, 1, .7, .93, .66];
    for (let i = 0; i < radii.length; i++) {
      const a = i / radii.length * TAU;
      const r = (118 + out(p) * 72) * radii[i];
      if(i){ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * .82);}else{ctx.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * .82);}
    }
    ctx.closePath(); ctx.fillStyle = '#ffe98b'; ctx.fill();
    ctx.strokeStyle = colors.cream; ctx.lineWidth = 5; ctx.stroke();
    ctx.restore();
    const r = lerp(45, 245, out(p));
    ctx.save(); ctx.globalAlpha *= (1 - p) * .6;
    ellipse(-5, 15, r, r * .74, null, colors.gold, lerp(9, .6, p));
    ellipse(-5, 15, r * .82, r * .61, null, colors.cream, lerp(3, .5, p));
    ctx.restore();
    ctx.save();
    for (let i = 0; i < 15; i++) {
      const a = i / 15 * TAU + .1;
      const r1 = 143 + out(p) * 40;
      const r2 = r1 + (24 + i % 4 * 9) * Math.sin(Math.PI * p);
      ctx.globalAlpha = (1 - p) * (i % 3 === 0 ? .8 : .5);
      line([[Math.cos(a) * r1, Math.sin(a) * r1 * .71], [Math.cos(a) * r2, Math.sin(a) * r2 * .71]], i % 3 ? colors.ink : colors.blush, i % 3 ? 2 : 4);
    }
    ctx.restore();
  }

  const particles = Array.from({ length: 26 }, (_, i) => ({
    a: i * 2.399963 + .2,
    r: 145 + (i * 47 % 108),
    size: 3 + i * 13 % 9,
    delay: .3 + i % 5 * .033,
    life: .82 + i % 4 * .21,
    spin: (i % 2 ? -1 : 1) * (1.6 + i % 3),
    type: i % 4,
    color: [colors.gold, settings.accent, colors.teal, colors.cream][i % 4]
  }));

  function sparks(t) {
    if (!settings.particles) return;
    for (const p of particles) {
      const u = (t - p.delay) / p.life;
      if (u <= 0 || u >= 1) continue;
      const radius = lerp(64, p.r, out(u));
      const x = Math.cos(p.a) * radius;
      const y = Math.sin(p.a) * radius * .68 + 54 * u * u;
      const alpha = Math.min(1, u * 9) * (1 - smooth(range(u, .38, 1)));
      ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(u * p.spin);
      if (p.type === 0) star(0, 0, p.size + 2, 0, p.color);
      else if (p.type === 1) {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.roundRect(-p.size / 2, -p.size, p.size, p.size * 1.7, 2); ctx.fill();
      } else if (p.type === 2) ellipse(0, 0, p.size * .6, p.size * .6, null, p.color, 2.4);
      else line([[-p.size / 2, -p.size], [0, 0], [p.size / 2, p.size]], p.color, 2.8);
      ctx.restore();
    }
    const places = [[-196, -73, 12, .48], [182, 58, 11, .63], [132, -127, 9, .82], [-128, 137, 8, .73]];
    for (const [x, y, r, delay] of places) {
      const u = (t - delay) / 1.6;
      if (u <= 0 || u >= 1) continue;
      const s = Math.pow(Math.sin(Math.PI * u), .7);
      star(x, y - u * 18, r * s, u * .7, r % 2 ? colors.teal : colors.gold, s);
    }
  }

  const characterLayer = buffer ??= document.createElement('canvas');
  if (characterLayer.width !== 800) { characterLayer.width = 800; characterLayer.height = 800; }
  const characterLayerContext = characterLayer.getContext('2d');
  characterLayerContext.imageSmoothingQuality = 'high';

  function smoothBand(v, a, b) { return smooth(range(v, a, b)); }

  // A continuous deformation keeps the head, cat and hat joined while their
  // secondary motions settle at different speeds. The edited facial art stays intact.
  function characterVertex(u, v, t) {
    const seconds = Math.max(0, t - .28);
    const catLag = Math.max(0, t - .39);
    const hatLag = Math.max(0, t - .35);
    let x = (u - .5) * 296;
    let y = (v - .5) * 276;
    const cat = smoothBand(u, .21, .34) * (1 - smoothBand(u, .58, .7)) * (1 - smoothBand(v, .23, .36));
    const hat = smoothBand(u, .53, .74) * (1 - smoothBand(v, .48, .72));
    const catHop = Math.sin(catLag * 20) * Math.exp(-catLag * 4.2) * 12;
    y -= cat * catHop;
    x += cat * Math.sin(catLag * 15) * Math.exp(-catLag * 4.8) * 2.4;
    const tilt = Math.sin(hatLag * 17) * Math.exp(-hatLag * 4) * .105;
    const pivotX = (.66 - .5) * 296, pivotY = (.46 - .5) * 276;
    x += hat * (-(y - pivotY) * tilt);
    y += hat * ((x - pivotX) * tilt - Math.sin(hatLag * 17) * Math.exp(-hatLag * 4) * 3);
    const hair = smoothBand(v, .56, .97) * smoothBand(Math.abs(u - .5), .15, .42);
    x += hair * Math.sin(seconds * 10 + u * 3.5) * Math.exp(-seconds * 1.55) * 3.8;
    y += hair * Math.cos(seconds * 9 + u * 2) * Math.exp(-seconds * 2) * 1.8;
    return { x, y, sx: u * 720, sy: v * 670 };
  }

  function texturedTriangle(image, a, b, c) {
    const renderer = characterLayerContext;
    const det = a.sx * (b.sy - c.sy) + b.sx * (c.sy - a.sy) + c.sx * (a.sy - b.sy);
    const m11 = (a.x * (b.sy - c.sy) + b.x * (c.sy - a.sy) + c.x * (a.sy - b.sy)) / det;
    const m21 = (a.x * (c.sx - b.sx) + b.x * (a.sx - c.sx) + c.x * (b.sx - a.sx)) / det;
    const dx = (a.x * (b.sx * c.sy - c.sx * b.sy) + b.x * (c.sx * a.sy - a.sx * c.sy) + c.x * (a.sx * b.sy - b.sx * a.sy)) / det;
    const m12 = (a.y * (b.sy - c.sy) + b.y * (c.sy - a.sy) + c.y * (a.sy - b.sy)) / det;
    const m22 = (a.y * (c.sx - b.sx) + b.y * (a.sx - c.sx) + c.y * (b.sx - a.sx)) / det;
    const dy = (a.y * (b.sx * c.sy - c.sx * b.sy) + b.y * (c.sx * a.sy - a.sx * c.sy) + c.y * (a.sx * b.sy - b.sx * a.sy)) / det;
    const centerX = (a.x + b.x + c.x) / 3, centerY = (a.y + b.y + c.y) / 3;
    renderer.save(); renderer.beginPath();
    for (const [i, p] of [a, b, c].entries()) {
      const vx = p.x - centerX, vy = p.y - centerY, len = Math.hypot(vx, vy) || 1;
      const px = p.x + vx / len * 1.4, py = p.y + vy / len * 1.4;
      if (i) renderer.lineTo(px, py); else renderer.moveTo(px, py);
    }
    renderer.closePath(); renderer.clip();
    renderer.transform(m11, m12, m21, m22, dx, dy);
    renderer.drawImage(image, 0, 0, 720, 670); renderer.restore();
  }

  function characterMesh(image, t) {
    characterLayerContext.setTransform(1, 0, 0, 1, 0, 0);
    characterLayerContext.clearRect(0, 0, 800, 800);
    characterLayerContext.setTransform(2.5, 0, 0, 2.5, 400, 400);
    const cols = 10, rows = 12, vertices = [];
    for (let j = 0; j <= rows; j++) {
      const row = [];
      for (let i = 0; i <= cols; i++) row.push(characterVertex(i / cols, j / rows, t));
      vertices.push(row);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = vertices[j][i], b = vertices[j][i + 1], c = vertices[j + 1][i], d = vertices[j + 1][i + 1];
      texturedTriangle(image, a, b, c); texturedTriangle(image, b, d, c);
    }
    ctx.drawImage(characterLayer, -160, -160, 320, 320);
  }

  function face(t) {
    const intro = range(t, 0, .34);
    const pop = spring(intro);
    const anticipation = wave(t, .08, .29);
    const impactTime = Math.max(0, t - .28);
    const recoil = Math.sin(impactTime * 24) * Math.exp(-impactTime * 5.6);
    const expression = smooth(range(t, .24, .38));
    ctx.save();
    ctx.translate(-104, 3 + (1 - out(intro)) * 64 + Math.sin(t * 4.8) * 1.2);
    ctx.rotate(-.035 + recoil * .075);
    ctx.scale(Math.max(.001, pop * (1 + anticipation * .065)), Math.max(.001, pop * (1 - anticipation * .08)));
    if (expression < 1) {
      ctx.save(); ctx.globalAlpha *= 1 - expression; characterMesh(characterNormal, t); ctx.restore();
    }
    if (expression > 0) {
      ctx.save(); ctx.globalAlpha *= expression; characterMesh(characterSurprise, t); ctx.restore();
    }
    ctx.restore();
  }

  function letter(text, x, y, size, t, delay, rotation, fill) {
    const progress = range(t, delay, delay + .44);
    if (progress <= 0) return;
    const pop = spring(progress);
    const wobble = Math.sin((t - delay) * 22) * Math.exp(-(t - delay) * 4.5) * .13;
    ctx.save(); ctx.translate(x + (1 - out(progress)) * 25, y - (1 - out(progress)) * 68);
    ctx.rotate(rotation + wobble); ctx.scale(pop, pop);
    ctx.font = `900 ${size}px ${font}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    ctx.strokeStyle = colors.cream; ctx.lineWidth = 16; ctx.strokeText(text, 2, 8);
    for (let d = 8; d >= 0; d -= 2) {
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 8; ctx.strokeText(text, d * .18, d);
      ctx.fillStyle = colors.deep; ctx.fillText(text, d * .18, d);
    }
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 6; ctx.strokeText(text, 0, 0);
    const gradient = ctx.createLinearGradient(0, -size * .8, 0, 4);
    gradient.addColorStop(0, '#ffe2b6'); gradient.addColorStop(.36, fill); gradient.addColorStop(1, '#ad579a');
    ctx.fillStyle = gradient; ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function letters(t) {
    ctx.save(); ctx.translate(57, -5);
    letter('え', -10, -73, 63, t, .27, -.11, settings.accent);
    letter('っ', 45, -63, 56, t, .32, .05, settings.accent);
    letter('!', 65, 57, 146, t, .34, -.14, settings.accent);
    letter('?', 149, 47, 148, t, .41, .15, settings.accent);
    const u = range(t, .58, 1.45);
    if (u > 0 && u < 1) {
      const a = Math.sin(u * Math.PI);
      star(83, -39, 6 * a, u * .7, colors.cream, a);
      star(151, -63, 5 * a, -u * .9, colors.cream, a);
    }
    ctx.restore();
  }

  function draw(t) {

    if (t < 0 || t >= DURATION) return;
    const scale = Math.min(width / 736, height / 414) * settings.size;
    ctx.save(); ctx.translate(-scale*4,scale); ctx.scale(scale, scale);
    const exit = range(t, 3.05, DURATION);
    const vanish = smooth(exit);
    ctx.globalAlpha = 1 - vanish;
    ctx.translate(0, -vanish * 72);
    ctx.scale(1 - vanish * .38, 1 - vanish * .38);
    ctx.rotate(-vanish * .09);
    const shake = Math.exp(-Math.max(0, t - .27) * 14) * Math.sin(Math.max(0, t - .27) * 83) * 5;
    ctx.translate(shake, shake * .35);
    const enter = out(range(t, .1, .5));
    ctx.save(); ctx.globalAlpha *= .13 * enter;
    glow(-30, 5, 183, '#ffd25e', 1);
    ctx.restore();
    cloud(t); impact(t);
    if (t > .1) {
      ctx.save(); ctx.globalAlpha *= .13 * (1 - range(t, .12, .85));
      ellipse(-61, 130, 64 * enter, 8 * enter, colors.ink); ctx.restore();
    }
    sparks(t);
    face(t);
    letters(t);
    const sweat = range(t, .61, .97);
    if (sweat > 0) {
      const alpha = 1 - range(t, 1.4, 2.15);
      ctx.save(); ctx.translate(-243,23+sweat*10); ctx.rotate(-.21); ctx.scale(1 - .2 * sweat, spring(sweat)); ctx.globalAlpha *= alpha;
      ctx.beginPath(); ctx.moveTo(0, -19); ctx.bezierCurveTo(0, -19, -13, -2, -11, 6);
      ctx.bezierCurveTo(-8, 22, 12, 17, 12, 5); ctx.bezierCurveTo(12, -2, 0, -19, 0, -19); ctx.closePath();
      ctx.strokeStyle = colors.cream; ctx.lineWidth = 7; ctx.stroke(); ctx.fillStyle = colors.teal; ctx.fill(); ctx.strokeStyle = colors.ink; ctx.lineWidth = 2.2; ctx.stroke();
      line([[-5, 2], [-6, 6]], '#e1fffa', 2.4); ctx.restore();
    }
    ctx.restore();
  }


draw(time);}
