// こども向け太陽系 N体重力シミュレーション(space リポジトリの solarsystem.js が元)。
// 物理は本物のまま: 単位系 AU・年・太陽質量、G = 4π²、リープフロッグ法+適応刻み幅。
// こども向けの変更点:
//  - 天体の名前をひらがなに
//  - 惑星の表示サイズだけ太陽より大きめにブースト(5歳でも見える・タップできる)

import * as THREE from 'three';

export const POS_SCALE = 10;          // 1 AU = 10 表示単位
const G = 4 * Math.PI * Math.PI;      // AU³ / (年² · 太陽質量)
const AU_KM = 1.496e8;                // 1 AU は何 km か
export const EARTH_MASS = 3.003e-6;   // 地球質量(太陽質量単位)

const _tmpVec = new THREE.Vector3();  // 使い回し用(毎ステップの割り当てを避ける)

const DT_BASE = 2e-3;                 // 基本の刻み幅(年)
const ETA = 8e-3;                     // 適応刻み係数: dt = ETA / √aMax
const MAX_STEPS = 3000;               // 1フレームあたりの最大サブステップ数
const ESCAPE_DIST = 150;              // これ以上離れたら「飛び去った」扱い(AU)
const TRAIL_MAX = 12000;              // 軌跡の最大頂点数(超えたら間引いて全履歴を保持)

// 半径は実測値(km)、質量は太陽質量単位、a は軌道長半径(AU)。
// サイズ比は太陽も含めてすべて本物どおり。
export const BODY_DATA = [
  { key: 'sun',     name: 'たいよう',     radiusKm: 696000, mass: 1.0,     color: 0xffd75e },
  { key: 'mercury', name: 'すいせい',     radiusKm: 2440,   mass: 1.66e-7, a: 0.387, color: 0x9f8e84, phase: 4.40 },
  { key: 'venus',   name: 'きんせい',     radiusKm: 6052,   mass: 2.45e-6, a: 0.723, color: 0xe8c47a, phase: 1.85 },
  { key: 'earth',   name: 'ちきゅう',     radiusKm: 6371,   mass: 3.00e-6, a: 1.000, color: 0x4f94d4, phase: 0.00 },
  { key: 'mars',    name: 'かせい',       radiusKm: 3390,   mass: 3.23e-7, a: 1.524, color: 0xc1583c, phase: 5.60 },
  { key: 'jupiter', name: 'もくせい',     radiusKm: 69911,  mass: 9.55e-4, a: 5.203, color: 0xd8b48a, phase: 2.95 },
  { key: 'saturn',  name: 'どせい',       radiusKm: 58232,  mass: 2.86e-4, a: 9.537, color: 0xe3d3a3, phase: 5.95, ring: true },
  { key: 'uranus',  name: 'てんのうせい', radiusKm: 25362,  mass: 4.37e-5, a: 19.19, color: 0x9bd4d4, phase: 1.00 },
  { key: 'neptune', name: 'かいおうせい', radiusKm: 24622,  mass: 5.15e-5, a: 30.07, color: 0x5a7fd4, phase: 6.20 },
];

// 惑星はそのままだと小さすぎて5歳には見えないので、表示だけ大きくブーストする
// (×8でも太陽がいちばん大きいまま)
const KID_PLANET_BOOST = 8;

export class SolarSystem {
  constructor() {
    this.scene = new THREE.Scene();
    this.time = 0;               // 経過時間(年)
    this.exaggeration = 60;      // 表示サイズの誇張倍率(×1 = 実寸)
    this.onEvent = null;         // 吸収・離脱イベントの通知コールバック

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.32));
    this.light = new THREE.PointLight(0xfff4e0, 3, 0, 0);
    this.scene.add(this.light);
    this.scene.add(createBackgroundStars());

    // 太陽の光芒スプライト
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffcc66,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.glow);

    this.bodies = BODY_DATA.map((data) => this._createBody(data));
    this._initState();
  }

  // ---------- 構築 ----------

  _createBody(data) {
    const isSun = data.key === 'sun';
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      isSun
        ? new THREE.MeshBasicMaterial({ color: data.color })
        : new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.85 })
    );
    this.scene.add(mesh);

    if (data.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.45, 2.3, 48),
        new THREE.MeshBasicMaterial({
          color: 0xcdbf9a, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
        })
      );
      ring.rotation.x = Math.PI / 2 - 0.35;
      mesh.add(ring); // 親メッシュと一緒にスケールされる
    }

    // 遠くからでも見えるよう、画面上で一定サイズのマーカーとラベルを付ける
    const marker = makeMarker(data.color);
    const label = makeLabel(data.name);
    this.scene.add(marker);
    this.scene.add(label);

    // 軌跡(リングバッファ)
    const trailAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    trailAttr.setUsage(THREE.DynamicDrawUsage);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', trailAttr);
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: data.color, transparent: true, opacity: 0.55,
    }));
    trail.frustumCulled = false;
    this.scene.add(trail);

    // 最初の軌道を薄い円で残しておく(変化の比較用)
    if (!isSun) {
      const pts = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(
          Math.cos(t) * data.a * POS_SCALE, 0, Math.sin(t) * data.a * POS_SCALE));
      }
      const refOrbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x33486a, transparent: true, opacity: 0.3 })
      );
      this.scene.add(refOrbit);
    }

    return {
      ...data,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      acc: new THREE.Vector3(),
      massScale: 1,
      sizeScale: 1,
      extraMass: 0,   // 太陽が惑星を飲み込んだぶん
      alive: true,
      escaped: false,
      mesh, marker, label,
      trailAttr, trailGeo, trail,
      trailCount: 0,
      lastTrail: null,
    };
  }

  // 位置・速度・スケールを初期状態にする
  _initState() {
    this.time = 0;
    const momentum = new THREE.Vector3();
    for (const b of this.bodies) {
      b.massScale = 1;
      b.sizeScale = 1;
      b.extraMass = 0;
      b.alive = true;
      b.escaped = false;
      b.mesh.visible = true;
      b.marker.visible = true;
      b.label.visible = true;
      this.clearTrail(b.key);

      if (b.key === 'sun') {
        b.pos.set(0, 0, 0);
        b.vel.set(0, 0, 0);
      } else {
        // 円軌道で初期化: v = √(G·M太陽 / a)
        const v = Math.sqrt(G * (1 + b.mass) / b.a);
        b.pos.set(Math.cos(b.phase) * b.a, 0, Math.sin(b.phase) * b.a);
        b.vel.set(-Math.sin(b.phase) * v, 0, Math.cos(b.phase) * v);
        momentum.addScaledVector(b.vel, b.mass);
      }
    }
    // 系全体の運動量がゼロになるよう太陽に逆向きの速度を与える(重心が流れない)
    this.bodies[0].vel.copy(momentum).multiplyScalar(-1);
  }

  reset() {
    this._initState();
  }

  // ---------- 物理 ----------

  effMass(b) {
    return b.mass * b.massScale + b.extraMass;
  }

  // 実際の物理半径(AU)。サイズスライダーのぶんだけ変わる
  physRadiusAU(b) {
    return (b.radiusKm / AU_KM) * b.sizeScale;
  }

  // 画面上の半径(表示単位)= 物理半径 × 誇張倍率(惑星はさらにブースト)
  displayRadius(b) {
    const boost = b.key === 'sun' ? 1 : KID_PLANET_BOOST;
    return this.physRadiusAU(b) * this.exaggeration * POS_SCALE * boost;
  }

  _computeAccels() {
    const bs = this.bodies;
    for (const b of bs) b.acc.set(0, 0, 0);
    for (let i = 0; i < bs.length; i++) {
      const bi = bs[i];
      if (!bi.alive) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const bj = bs[j];
        if (!bj.alive) continue;
        const dx = bj.pos.x - bi.pos.x;
        const dy = bj.pos.y - bi.pos.y;
        const dz = bj.pos.z - bi.pos.z;
        // ソフトニング: 天体半径より近づいたら力を頭打ちにして発散を防ぐ
        const eps = this.physRadiusAU(bi) + this.physRadiusAU(bj) + 1e-4;
        const r2 = dx * dx + dy * dy + dz * dz + eps * eps;
        const inv = G / (r2 * Math.sqrt(r2));
        const fi = inv * this.effMass(bj);
        const fj = inv * this.effMass(bi);
        bi.acc.x += fi * dx; bi.acc.y += fi * dy; bi.acc.z += fi * dz;
        bj.acc.x -= fj * dx; bj.acc.y -= fj * dy; bj.acc.z -= fj * dz;
      }
    }
    let aMax = 0;
    for (const b of bs) {
      if (b.alive) aMax = Math.max(aMax, b.acc.lengthSq());
    }
    return Math.sqrt(aMax);
  }

  // dtYears ぶんシミュレーションを進める。
  // 接近遭遇などで加速度が大きいときは刻み幅を自動で細かくする。
  advance(dtYears) {
    let remaining = dtYears;
    let steps = 0;
    while (remaining > 1e-9 && steps < MAX_STEPS) {
      const aMax = this._computeAccels();
      let dt = Math.min(DT_BASE, remaining);
      if (aMax > 0) dt = Math.min(dt, ETA / Math.sqrt(aMax));

      // リープフロッグ (kick - drift - kick)
      for (const b of this.bodies) {
        if (!b.alive) continue;
        b.vel.addScaledVector(b.acc, dt / 2);
        b.pos.addScaledVector(b.vel, dt);
      }
      this._computeAccels();
      for (const b of this.bodies) {
        if (!b.alive) continue;
        b.vel.addScaledVector(b.acc, dt / 2);
      }
      remaining -= dt;
      steps++;
      // 吸収判定は毎サブステップ行う。最接近時は数千km/sで通過するため、
      // フレームごとの判定ではすり抜けてしまう
      this._checkAbsorption();
      // 軌跡もサブステップごとに記録する。フレームごとだと高速再生時に
      // 楕円がカクカクの折れ線になってしまう
      for (const b of this.bodies) {
        if (b.alive) this._pushTrail(b, _tmpVec.copy(b.pos).multiplyScalar(POS_SCALE));
      }
    }
    this.time += dtYears - Math.max(remaining, 0);
    this._checkEscape();
  }

  _checkAbsorption() {
    const sun = this.bodies[0];
    // 吸収判定は画面上の太陽の大きさに合わせる(見た目と一致させるため)
    const absorbR = this.physRadiusAU(sun) * this.exaggeration;
    for (const b of this.bodies) {
      if (b.key === 'sun' || !b.alive) continue;
      if (b.pos.distanceTo(sun.pos) < absorbR) {
        b.alive = false;
        b.mesh.visible = false;
        b.marker.visible = false;
        b.label.visible = false;
        sun.extraMass += this.effMass(b);
        this.onEvent?.(`🔥 ${b.name}が たいように たべられちゃった!`);
      }
    }
  }

  _checkEscape() {
    const sun = this.bodies[0];
    for (const b of this.bodies) {
      if (b.key === 'sun' || !b.alive || b.escaped) continue;
      if (b.pos.distanceTo(sun.pos) > ESCAPE_DIST) {
        b.escaped = true;
        this.onEvent?.(`🚀 ${b.name}が とおくへ とんでいっちゃった!`);
      }
    }
  }

  // ---------- 操作 ----------

  getBody(key) {
    return this.bodies.find((b) => b.key === key);
  }

  setMassScale(key, scale) {
    this.getBody(key).massScale = scale; // 次のステップから重力に反映される
  }

  setSizeScale(key, scale) {
    this.getBody(key).sizeScale = scale;
  }

  setExaggeration(e) {
    this.exaggeration = e;
  }

  // 太陽からの距離を変える(向きと速度はそのまま → 軌道が乱れる)
  setDistanceAU(key, au) {
    const b = this.getBody(key);
    const sun = this.bodies[0];
    const rel = b.pos.clone().sub(sun.pos);
    if (rel.lengthSq() < 1e-12) rel.set(1, 0, 0);
    rel.setLength(au);
    b.pos.copy(sun.pos).add(rel);
    b.escaped = au > ESCAPE_DIST;
    this.clearTrail(key);
  }

  // 今いる位置を保ったまま、安定した円軌道に乗る速度を与え直す。
  // ドラッグや距離変更で乱れた惑星を落ち着かせるのに使う
  circularize(key) {
    const b = this.getBody(key);
    const sun = this.bodies[0];
    if (!b.alive || b.key === 'sun') return;
    const rel = b.pos.clone().sub(sun.pos);
    const r = rel.length();
    if (r < 1e-9) return;
    // いまの軌道面・公転方向を保つ。ほぼ直線落下中なら水平面を使う
    const axis = rel.clone().cross(b.vel.clone().sub(sun.vel));
    if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
    axis.normalize();
    const tangent = axis.cross(rel).normalize();
    const v = Math.sqrt(G * (this.effMass(sun) + this.effMass(b)) / r);
    b.vel.copy(sun.vel).addScaledVector(tangent, v);
    b.escaped = r > ESCAPE_DIST;
    this.clearTrail(key);
  }

  // 2つの天体(太陽も可)の位置と速度をまるごと交換する。
  // 惑星どうしなら公転速度は質量にほぼよらないので円軌道のまま。
  // 太陽と入れ替えると重力の中心が移動し、太陽系全体が組み変わっていく
  swapBodies(keyA, keyB) {
    const a = this.getBody(keyA);
    const b = this.getBody(keyB);
    if (!a.alive || !b.alive || a === b) return;
    const p = a.pos.clone();
    a.pos.copy(b.pos);
    b.pos.copy(p);
    const v = a.vel.clone();
    a.vel.copy(b.vel);
    b.vel.copy(v);
    [a.escaped, b.escaped] = [b.escaped, a.escaped];
    // 太陽との入れ替えで系全体が画面外へ流れていかないよう、
    // 全体の運動量を打ち消す(相対的な運動は変わらない)
    this._zeroMomentum();
    this.clearTrail(keyA);
    this.clearTrail(keyB);
  }

  _zeroMomentum() {
    const drift = new THREE.Vector3();
    let total = 0;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      drift.addScaledVector(b.vel, this.effMass(b));
      total += this.effMass(b);
    }
    drift.divideScalar(total); // 重心の速度
    for (const b of this.bodies) {
      if (b.alive) b.vel.sub(drift);
    }
  }

  // ドラッグ移動: 表示座標で位置を直接指定(速度はそのまま)
  setDisplayPosition(key, v) {
    this.getBody(key).pos.set(v.x / POS_SCALE, v.y / POS_SCALE, v.z / POS_SCALE);
  }

  clearTrail(key) {
    const b = this.getBody(key);
    b.trailCount = 0;
    b.lastTrail = null;
    b.trailGeo.setDrawRange(0, 0);
  }

  clearAllTrails() {
    for (const b of this.bodies) this.clearTrail(b.key);
  }

  _pushTrail(b, p) {
    // 点を打つ間隔は太陽からの距離に比例(=ほぼ等角度サンプリング)。
    // 太陽の近くを高速で回り込む鋭いカーブも滑らかに描ける
    const step = b.key === 'sun'
      ? 0.1
      : Math.max(0.02, b.pos.distanceTo(this.bodies[0].pos) * POS_SCALE * 0.025);
    if (b.lastTrail && b.lastTrail.distanceTo(p) < step) return;
    if (b.trailCount === TRAIL_MAX) {
      // 満杯になっても軌跡は消さない。1点おきに間引いて全履歴を残す
      // (古い部分の点がすこし粗くなるだけ)
      const arr = b.trailAttr.array;
      const half = TRAIL_MAX >> 1;
      for (let i = 1; i < half; i++) {
        arr[i * 3] = arr[i * 6];
        arr[i * 3 + 1] = arr[i * 6 + 1];
        arr[i * 3 + 2] = arr[i * 6 + 2];
      }
      b.trailCount = half;
    }
    b.trailAttr.setXYZ(b.trailCount, p.x, p.y, p.z);
    b.trailCount++;
    b.trailAttr.needsUpdate = true;
    b.trailGeo.setDrawRange(0, b.trailCount);
    b.lastTrail = (b.lastTrail ?? new THREE.Vector3()).copy(p);
  }

  // ---------- 描画反映 ----------

  syncVisuals() {
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const p = b.mesh.position.copy(b.pos).multiplyScalar(POS_SCALE);
      b.mesh.scale.setScalar(Math.max(this.displayRadius(b), 1e-6));
      b.marker.position.copy(p);
      b.label.position.copy(p);
    }
    const sun = this.bodies[0];
    this.glow.position.copy(sun.mesh.position);
    this.glow.scale.setScalar(Math.max(this.displayRadius(sun) * 6, 0.5));
    this.light.position.copy(sun.mesh.position);
  }

  // 画面座標 (px, py) に一番近い天体を返す(タップ・ドラッグ用)
  pickBody(camera, px, py, w, h) {
    const v = new THREE.Vector3();
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    let best = null;
    let bestD = Infinity;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      v.copy(b.pos).multiplyScalar(POS_SCALE);
      const distCam = camera.position.distanceTo(v);
      v.project(camera);
      if (v.z > 1) continue; // カメラの後ろ
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - px, sy - py);
      const rpx = (this.displayRadius(b) / (distCam * tanHalf)) * (h / 2);
      const thr = Math.max(18, rpx + 8);
      if (d < thr && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }
}

// ---------- スプライト類 ----------

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 38px "Hiragino Sans", "Yu Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#dce8ff';
  ctx.fillText(text, 128, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
    sizeAttenuation: false, // どれだけ離れても同じ大きさで表示
  }));
  sprite.scale.set(0.16, 0.04, 1);
  sprite.center.set(0.5, -0.45); // アンカーより少し上に表示
  return sprite;
}

function makeMarker(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,
  }));
  sprite.scale.set(0.014, 0.014, 1);
  return sprite;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,235,180,1)');
  g.addColorStop(0.35, 'rgba(255,200,110,0.45)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 遠方の背景星(動かない)
export function createBackgroundStars(count = 1800, distance = 900) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi = Math.random() * Math.PI * 2;
    const cosT = Math.random() * 2 - 1;
    const sinT = Math.sqrt(1 - cosT * cosT);
    const d = distance * (0.7 + Math.random() * 0.3);
    pos[i * 3] = d * sinT * Math.cos(phi);
    pos[i * 3 + 1] = d * cosT;
    pos[i * 3 + 2] = d * sinT * Math.sin(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x8898bb,
    size: 1.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.8,
  }));
}
