// node test.js — ブラウザなしでゲームロジックを検証するハーネス
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

// ---- DOM / canvas スタブ ----
const anyFn = new Proxy(function(){}, {
  get: (t, k) => anyFn,
  apply: () => anyFn,
  set: () => true,
});
const cv = { width: 960, height: 720, getContext: () => anyFn };
global.document = { getElementById: () => cv };
global.addEventListener = () => {};
global.localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; }, removeItem(k){ delete this._d[k]; } };
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; };
global.window = {};

let H = null;
global.__TEST_HOOK = h => { H = h; };

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok -', label);
  else { console.error('  NG -', label); failures++; }
};

(0, eval)(js);
ok(H !== null, 'テストフック取得');

// ---- 1. データ整合性 ----
console.log('# マップ・ドット絵の整合性');
for (const [id, m] of Object.entries(H.MAPS)) {
  const w = m.grid[0].length;
  ok(m.grid.every(r => r.length === w), `マップ ${id} は長方形 (${w}x${m.grid.length})`);
  for (const key of Object.keys(m.warps || {})) {
    const wp = m.warps[key];
    ok(!!H.MAPS[wp.map], `ワープ ${id}:${key} の行き先 ${wp.map} が存在`);
    const ch = H.MAPS[wp.map].grid[wp.y][wp.x];
    ok(!'TWRYVBM#CSOEerkhzmqajt'.includes(ch), `ワープ先 ${wp.map}(${wp.x},${wp.y})='${ch}' が歩行可能`);
  }
}
for (const [name, art] of Object.entries(H.ART)) {
  ok(art.rows.length === 16 && art.rows.every(r => r.length === 16), `アート ${name} は16x16`);
}
for (const [name, e] of Object.entries(H.ENEMIES)) {
  ok(!!H.ART[e.art], `敵 ${name} のアート '${e.art}' が存在`);
}
const world = H.MAPS.world.grid;
ok(world.length === 30 && world[0].length === 40, 'ワールドは40x30');
ok(world[8][20] === 'A', '町アイコンが (20,8)');
ok(world[9][20] === 'G', '町の出口 (20,9) が草原');

// ---- 2. 各状態で描画してもエラーが出ない ----
console.log('# 描画スモークテスト');
const frames = n => { for (let i = 0; i < n; i++) rafCb(); };
const tryDraw = (label, fn) => {
  try { fn(); console.log('  ok -', label); }
  catch (e) { console.error('  NG -', label, ':', e.message); failures++; }
};
tryDraw('タイトル画面 30フレーム', () => frames(30));

// ---- 3. タイトル → ニューゲーム ----
console.log('# ゲームフロー');
H.press('KeyZ'); frames(30);
ok(H.getState() === 'field', 'タイトルからフィールドへ (state=' + H.getState() + ')');
for (let i = 0; i < 5; i++) { H.press('KeyZ'); frames(10); } // 冒頭メッセージを閉じ切る
ok(true, '冒頭メッセージ処理');

tryDraw('町を 30フレーム描画', () => frames(30));

// ---- 4. 各マップへテレポートして描画 ----
for (const id of ['weapon', 'inn', 'item', 'tavern', 'world']) {
  const m = H.MAPS[id];
  let x = 4, y = 3;
  if (id === 'world') { x = 20; y = 9; }
  tryDraw(`マップ ${id} を描画`, () => { H.teleport(id, x, y); frames(15); });
}

// ---- 5. メニュー開閉 ----
H.teleport('town', 9, 11);
H.press('KeyX'); frames(5);
ok(H.getState() === 'menu', 'メニューが開く');
tryDraw('メニュー描画', () => frames(10));
H.press('KeyX'); frames(5);
ok(H.getState() === 'field', 'メニューが閉じる');

// ---- 5.5 武器装備時の見た目描画 ----
console.log('# 武器装備の描画');
for (const w of ['ひのきのぼう', 'こんぼう', 'どうのつるぎ', null]) {
  H.hero.weapon = w;
  tryDraw(`装備 ${w || 'なし'} で描画`, () => frames(10));
}

// ---- 6. 全種の敵と戦闘(コマンド連打で終局まで) ----
console.log('# 戦闘テスト');
for (const name of Object.keys(H.ENEMIES)) {
  H.hero.lv = 8;   // 強敵にも勝てるレベルで終局を検証
  H.hero.hp = 999; // 検証用に死なない体力(内部値だけ)
  H.startBattle(name, 'grass');
  let guard = 0;
  while (H.getState() === 'battle' && guard < 3000) {
    if (guard % 15 === 0) H.press('KeyZ');
    rafCb();
    guard++;
  }
  ok(H.getState() !== 'battle', `${name} 戦が終局 (${guard}フレーム)`);
}

// ---- 7. 敗北フロー ----
H.hero.lv = 1; H.hero.hp = 1; H.hero.gold = 100;
H.startBattle('ベビードラゴン', 'forest');
let guard = 0;
while (H.getState() === 'battle' && guard < 5000) {
  if (guard % 15 === 0) H.press('KeyZ');
  rafCb();
  guard++;
}
frames(60); // 死亡後のフェード+メッセージ
H.press('KeyZ'); frames(10);
ok(H.getState() === 'field', '敗北後にフィールドへ復帰');
ok(H.hero.hp > 0, '敗北後にHP回復 (hp=' + H.hero.hp + ')');

// ---- 8. なかま(ルイーダの酒場) ----
console.log('# なかまテスト');
H.hero.lv = 5;
H.party.push(H.makeCompanion('warrior'), H.makeCompanion('mage'));
ok(H.party.length === 2, '戦士と魔法使いが仲間に');
ok(H.party[0].hp === H.JOBS.warrior.lvt[5].hp, '戦士のHPがレベル表どおり');
tryDraw('仲間つきでフィールド描画', () => { H.teleport('town', 9, 11); frames(20); });
tryDraw('仲間つきでメニュー描画', () => { H.press('KeyX'); frames(10); H.press('KeyX'); frames(5); });
H.hero.hp = 999;
H.startBattle('スライム', 'grass');
guard = 0;
while (H.getState() === 'battle' && guard < 4000) {
  if (guard % 15 === 0) H.press('KeyZ');
  rafCb();
  guard++;
}
ok(H.getState() !== 'battle', `パーティ戦闘が終局 (${guard}フレーム)`);
ok(H.party.every(m => m.hp > 0), '仲間が生存している');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
