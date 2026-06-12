// 惑星の「本物っぽい」見た目を Canvas で手続き的に生成する。
// 外部画像に依存せず、ビルドも不要。生成物は2種類:
//  - makePlanetTexture(key): 球体に貼る正距円筒図法(2:1)テクスチャ(THREE.Texture)
//  - makePlanetIcon(key, size): 図鑑カード用に球体ライティングした円アイコン(canvas)
//
// 各惑星の特徴を再現:
//  太陽=粒状斑、水星=クレーター、金星=渦巻く雲、地球=海と大陸と雲、
//  火星=赤い砂と極冠、木星=横縞と大赤斑、土星=淡い縞、天王星/海王星=青のガス

import * as THREE from 'three';

// 決定的な疑似乱数(惑星ごとに毎回同じ模様になる)
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TW = 512, TH = 256; // テクスチャの大きさ(正距円筒 2:1)

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

// 横縞のガス惑星(木星・土星・天王星・海王星)
function drawBands(ctx, rng, palette, contrast) {
  const bands = 26;
  let y = 0;
  for (let i = 0; i < bands; i++) {
    const h = TH / bands * (0.6 + rng() * 0.9);
    const base = palette[Math.floor(rng() * palette.length)];
    const tone = (rng() - 0.5) * contrast;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, mix(base, tone > 0 ? 0xffffff : 0x000000, Math.abs(tone)));
    grad.addColorStop(1, mix(base, tone > 0 ? 0x000000 : 0xffffff, Math.abs(tone) * 0.6));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, TW, h + 1);
    // 縞の中の渦・乱れ
    for (let k = 0; k < 18; k++) {
      ctx.fillStyle = mix(base, rng() > 0.5 ? 0xffffff : 0x000000, rng() * 0.25);
      const ex = rng() * TW, ey = y + rng() * h;
      ctx.beginPath();
      ctx.ellipse(ex, ey, h * (0.4 + rng()), h * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    y += h;
  }
}

// クレーター(水星・月っぽい)
function drawCraters(ctx, rng, count) {
  for (let i = 0; i < count; i++) {
    const x = rng() * TW, y = rng() * TH;
    const r = 2 + rng() * 14;
    ctx.fillStyle = `rgba(0,0,0,${0.12 + rng() * 0.2})`;
    ctx.beginPath(); ctx.arc(x + r * 0.2, y + r * 0.2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.10 + rng() * 0.15})`;
    ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.9, 0, Math.PI * 2); ctx.fill();
  }
}

// もやもやした斑点ノイズ(雲や砂の質感)
function drawSpeckle(ctx, rng, color, count, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * (0.4 + rng() * 0.6);
    const x = rng() * TW, y = rng() * TH;
    const r = 2 + rng() * maxR;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const PAINTERS = {
  sun(ctx, rng) {
    ctx.fillStyle = '#ff9d2b';
    ctx.fillRect(0, 0, TW, TH);
    drawSpeckle(ctx, rng, '#ffd860', 900, 7, 0.5);
    drawSpeckle(ctx, rng, '#ff6a1a', 700, 6, 0.4);
    drawSpeckle(ctx, rng, '#fff3b0', 300, 3, 0.7);
  },
  mercury(ctx, rng) {
    ctx.fillStyle = '#8f8479';
    ctx.fillRect(0, 0, TW, TH);
    drawSpeckle(ctx, rng, '#6f655a', 500, 9, 0.3);
    drawSpeckle(ctx, rng, '#b6ac9f', 400, 7, 0.3);
    drawCraters(ctx, rng, 260);
  },
  venus(ctx, rng) {
    ctx.fillStyle = '#e6c98a';
    ctx.fillRect(0, 0, TW, TH);
    // 渦を巻くような淡い雲
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = mix(0xe6c98a, rng() > 0.5 ? 0xfff0c0 : 0xc59a55, rng() * 0.6);
      ctx.lineWidth = 4 + rng() * 14;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      const y = rng() * TH;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(TW * 0.3, y + (rng() - 0.5) * 40, TW * 0.7, y + (rng() - 0.5) * 40, TW, y + (rng() - 0.5) * 30);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawSpeckle(ctx, rng, '#fff0c8', 200, 6, 0.25);
  },
  earth(ctx, rng) {
    // 海
    const sea = ctx.createLinearGradient(0, 0, 0, TH);
    sea.addColorStop(0, '#1f5fa8'); sea.addColorStop(0.5, '#2a78c8'); sea.addColorStop(1, '#1f5fa8');
    ctx.fillStyle = sea; ctx.fillRect(0, 0, TW, TH);
    // 大陸(緑〜茶のかたまり)
    for (let i = 0; i < 14; i++) {
      const cx = rng() * TW, cy = 30 + rng() * (TH - 60);
      ctx.fillStyle = mix(0x3a7d3a, 0x9a8246, rng());
      for (let k = 0; k < 30; k++) {
        ctx.globalAlpha = 0.9;
        const x = cx + (rng() - 0.5) * 90, y = cy + (rng() - 0.5) * 60;
        ctx.beginPath(); ctx.arc(x, y, 6 + rng() * 16, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 極の氷
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, TW, 14); ctx.fillRect(0, TH - 14, TW, 14);
    ctx.globalAlpha = 1;
    // 雲
    drawSpeckle(ctx, rng, '#ffffff', 260, 12, 0.45);
  },
  mars(ctx, rng) {
    ctx.fillStyle = '#b5572f';
    ctx.fillRect(0, 0, TW, TH);
    drawSpeckle(ctx, rng, '#d4744a', 500, 10, 0.35);
    drawSpeckle(ctx, rng, '#8a3d22', 500, 9, 0.35);
    // 暗い峡谷っぽい横の筋
    ctx.strokeStyle = 'rgba(90,40,25,0.5)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(40, TH * 0.55);
    ctx.bezierCurveTo(TW * 0.4, TH * 0.5, TW * 0.6, TH * 0.62, TW - 30, TH * 0.55);
    ctx.stroke();
    drawCraters(ctx, rng, 90);
    // 極冠
    ctx.fillStyle = '#f3f0ea';
    ctx.beginPath(); ctx.ellipse(TW / 2, 6, TW * 0.5, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(TW / 2, TH - 6, TW * 0.4, 14, 0, 0, Math.PI * 2); ctx.fill();
  },
  jupiter(ctx, rng) {
    drawBands(ctx, rng, [0xc9a87a, 0xe3cba0, 0xb08858, 0xe8d8b8, 0xa9794f], 0.5);
    // 大赤斑
    ctx.fillStyle = 'rgba(200,80,50,0.85)';
    ctx.beginPath(); ctx.ellipse(TW * 0.35, TH * 0.62, 34, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(230,140,100,0.6)';
    ctx.beginPath(); ctx.ellipse(TW * 0.35, TH * 0.62, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
  },
  saturn(ctx, rng) {
    drawBands(ctx, rng, [0xe3d3a3, 0xd8c48a, 0xeaddb8, 0xcdb988], 0.3);
  },
  uranus(ctx, rng) {
    const g = ctx.createLinearGradient(0, 0, 0, TH);
    g.addColorStop(0, '#a6e0e0'); g.addColorStop(0.5, '#bdeaea'); g.addColorStop(1, '#9ed6d6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
    drawBands(ctx, rng, [0xb6e4e4, 0xa6dada, 0xc4ecec], 0.12);
  },
  neptune(ctx, rng) {
    const g = ctx.createLinearGradient(0, 0, 0, TH);
    g.addColorStop(0, '#2e5cc8'); g.addColorStop(0.5, '#3f74e0'); g.addColorStop(1, '#2a52b8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, TW, TH);
    drawBands(ctx, rng, [0x3a68d4, 0x2e5cc8, 0x4f86e8], 0.18);
    // 大暗斑
    ctx.fillStyle = 'rgba(20,35,90,0.7)';
    ctx.beginPath(); ctx.ellipse(TW * 0.6, TH * 0.42, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
  },
};

// seed は惑星ごとに固定
const SEEDS = { sun: 7, mercury: 11, venus: 23, earth: 41, mars: 59, jupiter: 71, saturn: 89, uranus: 101, neptune: 113 };

function paintTo(ctx, key) {
  const rng = makeRng(SEEDS[key] ?? 1);
  (PAINTERS[key] ?? PAINTERS.mercury)(ctx, rng);
}

const _texCache = {};
export function makePlanetTexture(key) {
  if (_texCache[key]) return _texCache[key];
  const c = document.createElement('canvas');
  c.width = TW; c.height = TH;
  paintTo(c.getContext('2d'), key);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache[key] = tex;
  return tex;
}

// 図鑑・ふきだし用: 球体っぽくライティングした円アイコン(canvas要素を返す)
export function makePlanetIcon(key, size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // 平らなテクスチャを一旦作り、円に貼ってから陰影をのせる
  const flat = document.createElement('canvas');
  flat.width = TW; flat.height = TH;
  paintTo(flat.getContext('2d'), key);

  const r = size / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2); ctx.clip();
  // テクスチャの中央あたりを正方形で切り出して円に収める
  ctx.drawImage(flat, TW * 0.15, 0, TH, TH, 0, 0, size, size);
  // 立体感のための陰影(左上が明るい)
  const shade = ctx.createRadialGradient(r * 0.65, r * 0.6, r * 0.2, r, r, r);
  shade.addColorStop(0, 'rgba(255,255,255,0.25)');
  shade.addColorStop(0.6, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 土星の環
  if (key === 'saturn') {
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.32);
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = 'rgba(225,212,170,0.9)';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,185,140,0.7)';
    ctx.lineWidth = size * 0.03;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  return c;
}
