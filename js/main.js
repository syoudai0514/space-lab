// うちゅうラボ — 5さいから あそべる うちゅうの きょういくコンテンツ。
// 画面: ホーム / たいようけいラボ(本物のN体シミュレーション) / ほしのずかん / クイズ

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SolarSystem, POS_SCALE } from './kidsolar.js?v=1';
import { FACTS, EXPERIMENTS, QUIZ } from './facts.js?v=1';

const $ = (id) => document.getElementById(id);

// ---------- 画面の切り替え ----------
const screens = ['home', 'lab', 'zukan', 'quiz'];
function show(name) {
  for (const s of screens) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  if (name === 'quiz') startQuiz();
}
$('btn-lab').addEventListener('click', () => show('lab'));
$('btn-zukan').addEventListener('click', () => show('zukan'));
$('btn-quiz').addEventListener('click', () => show('quiz'));
for (const b of document.querySelectorAll('.home-btn')) {
  b.addEventListener('click', () => show('home'));
}

// ---------- 3Dシミュレーション ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const solar = new SolarSystem();

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 6000);
camera.position.set(0, 42, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 900;

let simSpeed = 0.0833; // ふつう = 1ヶ月/秒

// ---------- ふきだし(おはなし) ----------
const bubble = $('bubble');
let bubbleTimer = null;
function showFact(key) {
  const f = FACTS[key];
  if (!f) return;
  $('bubble-emoji').textContent = f.emoji;
  $('bubble-name').textContent = f.name;
  $('bubble-title').textContent = f.title;
  $('bubble-story').textContent = f.story;
  $('bubble-fun').textContent = `💡 ${f.fun}`;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
}
$('bubble-close').addEventListener('click', () => bubble.classList.add('hidden'));

// ---------- メッセージ(じっけんの かいせつ) ----------
const messageBox = $('message');
let messageTimer = null;
function say(text, long = false) {
  messageBox.textContent = text;
  messageBox.classList.remove('hidden');
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageBox.classList.add('hidden'), long ? 7000 : 4500);
}
solar.onEvent = (msg) => say(msg);

// ---------- じっけんボタン ----------
const expBar = $('experiments');
for (const exp of EXPERIMENTS) {
  const btn = document.createElement('button');
  btn.className = 'exp-btn';
  btn.textContent = `${exp.emoji} ${exp.label}`;
  btn.addEventListener('click', () => {
    exp.action(solar);
    say(exp.explain, true);
  });
  expBar.appendChild(btn);
}

$('reset-btn').addEventListener('click', () => {
  solar.reset();
  say('↺ もとに もどしたよ!');
});

// ---------- はやさ ----------
const speeds = { slow: 0.0192, normal: 0.0833, fast: 0.4 };
for (const [key, val] of Object.entries(speeds)) {
  $(`speed-${key}`).addEventListener('click', () => {
    simSpeed = val;
    for (const k of Object.keys(speeds)) {
      $(`speed-${k}`).classList.toggle('active', k === key);
    }
  });
}

// ---------- タップで おはなし / ドラッグで うごかす ----------
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerState = null;

canvas.addEventListener('pointerdown', (e) => {
  if (pointerState) return;
  const hit = solar.pickBody(camera, e.clientX, e.clientY, innerWidth, innerHeight);
  if (!hit) return;
  pointerState = { id: e.pointerId, key: hit.key, downX: e.clientX, downY: e.clientY, dragging: false, plane: null };
  controls.enabled = false;
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointerState || e.pointerId !== pointerState.id) return;
  const moved = Math.hypot(e.clientX - pointerState.downX, e.clientY - pointerState.downY);
  if (!pointerState.dragging && moved > 10) {
    pointerState.dragging = true;
    const b = solar.getBody(pointerState.key);
    pointerState.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.pos.y * POS_SCALE);
  }
  if (pointerState.dragging) {
    pointerNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(pointerState.plane, out)) {
      solar.setDisplayPosition(pointerState.key, out);
    }
  }
});

function endPointer(e, cancelled) {
  if (!pointerState || e.pointerId !== pointerState.id) return;
  if (pointerState.dragging) {
    solar.clearTrail(pointerState.key);
    say(`${solar.getBody(pointerState.key).name}を うごかしたよ! どんな みちを とおるかな?`);
  } else if (!cancelled) {
    showFact(pointerState.key);
  }
  pointerState = null;
  controls.enabled = true;
}
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));

// ---------- ほしのずかん ----------
const zukanGrid = $('zukan-grid');
for (const [key, f] of Object.entries(FACTS)) {
  const card = document.createElement('button');
  card.className = 'zukan-card';
  card.innerHTML = `<span class="zukan-emoji">${f.emoji}</span><span>${f.name}</span>`;
  card.addEventListener('click', () => showFact(key));
  zukanGrid.appendChild(card);
}

// ---------- クイズ ----------
let quizIndex = 0;
let quizScore = 0;
let quizLocked = false;

function startQuiz() {
  quizIndex = 0;
  quizScore = 0;
  renderQuiz();
}

function renderQuiz() {
  quizLocked = false;
  $('quiz-result').classList.add('hidden');
  $('quiz-question-area').classList.remove('hidden');
  const q = QUIZ[quizIndex];
  $('quiz-progress').textContent = `だい ${quizIndex + 1} もん / ぜんぶで ${QUIZ.length} もん`;
  $('quiz-question').textContent = q.q;
  $('quiz-feedback').textContent = '';
  const area = $('quiz-choices');
  area.innerHTML = '';
  q.choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-choice';
    btn.textContent = choice;
    btn.addEventListener('click', () => answerQuiz(i, btn));
    area.appendChild(btn);
  });
}

function answerQuiz(i, btn) {
  if (quizLocked) return;
  const q = QUIZ[quizIndex];
  if (i === q.answer) {
    quizLocked = true;
    quizScore++;
    btn.classList.add('correct');
    $('quiz-feedback').textContent = `🎉 せいかい! ${q.explain}`;
    setTimeout(() => {
      quizIndex++;
      if (quizIndex < QUIZ.length) renderQuiz();
      else showQuizResult();
    }, 2600);
  } else {
    btn.classList.add('wrong');
    $('quiz-feedback').textContent = '🤔 ざんねん! もういちど えらんでみよう';
  }
}

function showQuizResult() {
  $('quiz-question-area').classList.add('hidden');
  const r = $('quiz-result');
  r.classList.remove('hidden');
  $('quiz-score').textContent = `${QUIZ.length}もん 中 ${quizScore}もん せいかい!`;
  $('quiz-medal').textContent = quizScore === QUIZ.length ? '🏆 うちゅうはかせ にんてい!' : '🌟 よくがんばりました!';
}
$('quiz-retry').addEventListener('click', startQuiz);

// ---------- メインループ ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const labVisible = !$('screen-lab').classList.contains('hidden');
  if (labVisible) {
    const dragging = pointerState !== null && pointerState.dragging;
    if (!dragging) solar.advance(simSpeed * dt);
    solar.syncVisuals();
    controls.update();
    renderer.render(solar.scene, camera);
  }
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

show('home');
animate();
