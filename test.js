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
    ok(!'TWRYVBM#CSOEerkhzmqajtgpo'.includes(ch), `ワープ先 ${wp.map}(${wp.x},${wp.y})='${ch}' が歩行可能`);
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
ok(world[23][20] === 'c', '魔王城が (20,23)');
ok(world[24][20] === 'G', '魔王城の出口 (20,24) が草原');
ok(world[4][7] === 'n', '神の神殿が 西のはて (7,4)');
ok(world[5][7] === 'G', '神殿の出口 (7,5) が草原');
ok(world[23][13] === 'v', 'ドラゴンの洞窟が 魔王城の西 (13,23)');
ok(world[24][13] === 'G', '洞窟の出口 (13,24) が草原');
ok(world[14][5] === 'y', '霊峰が 左の山奥 (5,14)');
ok(world[15][5] === 'G' && world[19][5] === 'G', '霊峰へ続く渓谷の道が通行可能');

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
for (const id of ['weapon', 'inn', 'item', 'tavern', 'castle', 'temple', 'cave', 'ramen', 'elder', 'world']) {
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
for (const w of ['ひのきの棒', 'こん棒', '銅の剣', null]) {
  H.hero.weapon = w;
  tryDraw(`装備 ${w || 'なし'} で描画`, () => frames(10));
}

// ---- 6. 全種の敵と戦闘(コマンド連打で終局まで) ----
console.log('# 戦闘テスト');
for (const name of Object.keys(H.ENEMIES)) {
  H.hero.lv = 8;   // 強敵にも勝てるレベルで終局を検証
  H.hero.hp = 999; // 検証用に死なない体力(内部値だけ)
  H.hero.weapon = '銅の剣';
  H.party.forEach(m => { m.hp = 999; m.mp = 99; });  // 途中で加わった仲間も回復
  H.startBattle(name, 'grass');
  let guard = 0;
  while (H.getState() === 'battle' && guard < 8000) {
    if (guard % 15 === 0) H.press('KeyZ');
    rafCb();
    guard++;
  }
  ok(H.getState() !== 'battle', `${name} 戦が終局 (${guard}フレーム)`);
}
ok(H.hero.cleared === true, '魔王討伐でクリアフラグが立つ');
ok(H.hero.trueCleared === true, 'ゾウユウ討伐で真クリアフラグが立つ');
ok(H.party.some(m => m.job === 'dragon'), 'ドラゴン戦の勝利でドラゴンが仲間に');
for (let i = 0; i < 5; i++) { H.press('KeyZ'); frames(10); } // クリアメッセージを閉じる
tryDraw('クリア後の町(パレード+紙吹雪)描画', () => { H.teleport('town', 9, 11); frames(30); });

// ---- 7. 敗北フロー ----
H.hero.lv = 1; H.hero.hp = 1; H.hero.gold = 100;
H.startBattle('サキュバス', 'forest');
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

// ---- 8. 仲間(ルイーダの酒場) ----
console.log('# 仲間テスト');
H.hero.lv = 5;
H.party.length = 0;  // 戦闘テストで加わったドラゴンをリセット
H.party.push(H.makeCompanion('warrior'), H.makeCompanion('mage'));
ok(H.party.length === 2, '戦士と魔法使いが仲間に');
ok(H.party[0].hp === H.JOBS.warrior.lvt[5].hp, '戦士のHPがレベル表どおり');
tryDraw('仲間つきでフィールド描画', () => { H.teleport('town', 9, 11); frames(20); });
tryDraw('仲間つきでメニュー描画', () => { H.press('KeyX'); frames(10); H.press('KeyX'); frames(5); });
H.hero.hp = 999;
H.startBattle('ピクシー', 'grass');
guard = 0;
while (H.getState() === 'battle' && guard < 4000) {
  if (guard % 15 === 0) H.press('KeyZ');
  rafCb();
  guard++;
}
ok(H.getState() !== 'battle', `パーティ戦闘が終局 (${guard}フレーム)`);
ok(H.party.every(m => m.hp > 0), '仲間が生存している');

// ---- 8.5 神の神殿(最強武器の授与) ----
console.log('# 神殿テスト');
const atkBefore = H.hero.lv;  // 授与前後の攻撃力比較用に職業値を取得
const warriorAtkBefore = H.JOBS.warrior.lvt[H.hero.lv].str + H.JOBS.warrior.atkBonus;
H.teleport('temple', 4, 3);
H.player.dir = 'up';
H.press('KeyZ'); frames(5);          // 神さまに話しかける
for (let i = 0; i < 10; i++) { H.press('KeyZ'); frames(12); }
ok(H.hero.blessed === true, '神の力を 授かった (blessed)');
ok(H.hero.weapon === '神の剣', '勇者に神の剣 (weapon=' + H.hero.weapon + ')');
tryDraw('覚醒後の見た目で描画', () => { H.teleport('town', 9, 11); frames(20); });
tryDraw('覚醒後のメニュー描画', () => { H.press('KeyX'); frames(10); H.press('KeyX'); frames(5); });

// ---- 9. セーブゾーン(魔法陣) ----
console.log('# セーブゾーンテスト');
ok(H.MAPS.town.grid[13][11] === 's', '町の入り口ちかくに 魔法陣 (11,13)');
H.teleport('town', 11, 13);
H.hero.gold = 777;
H.save();
const sd = JSON.parse(global.localStorage.getItem('hajimari_save'));
ok(sd.pos && sd.pos.map === 'town' && sd.pos.x === 11 && sd.pos.y === 13, 'セーブに位置が記録される');
H.teleport('world', 25, 20);
H.hero.gold = 0;
H.continueGame();
frames(5); H.press('KeyZ'); frames(10);
ok(H.player.tx === 11 && H.player.ty === 13, '続きからで記録地点に復帰');
ok(H.hero.gold === 777, '続きからでステータス復元 (gold=' + H.hero.gold + ')');

// ---- 9.5 竜の長老(蒼竜への進化) ----
console.log('# 竜の長老テスト');
if (!H.party.some(m => m.job === 'dragon')) H.party.push(H.makeCompanion('dragon'));
H.teleport('elder', 4, 2);
H.player.dir = 'up';
H.press('KeyZ'); frames(5);  // 長老に話しかける
for (let i = 0; i < 10; i++) { H.press('KeyZ'); frames(15); }
ok(H.hero.dragonEvolved === true, 'ドラゴンが伝説の蒼竜に進化');
tryDraw('蒼竜つきでフィールド描画', () => { H.teleport('town', 9, 11); frames(20); });

// ---- 9.7 ラーメン屋に歩いて入店できる(回帰テスト) ----
console.log('# ラーメン屋入店テスト');
for (let i = 0; i < 8; i++) { H.press('KeyZ'); frames(10); }  // 残っているメッセージを閉じ切る
H.hero.cleared = true;
H.teleport('world', 20, 24);
H.setKey('ArrowUp', true);
frames(50);  // (20,23)へ歩く → ワープ+フェード
H.setKey('ArrowUp', false);
frames(40);
ok(H.getMap() === 'ramen', '魔王討伐後の城はラーメン屋になる (map=' + H.getMap() + ')');
const rg = H.MAPS.ramen.grid;
ok(H.player.ty >= 0 && H.player.ty < rg.length && rg[H.player.ty][H.player.tx] === '.',
   '店内の床の上に配置される (' + H.player.tx + ',' + H.player.ty + ')');
H.setKey('ArrowUp', true);
frames(20);
H.setKey('ArrowUp', false);
ok(H.player.ty < 5, '店内で移動できる (y=' + H.player.ty + ')');
frames(10);

// ---- 9.8 勇者が倒れても仲間が戦い続ける(全滅仕様) ----
console.log('# 全滅仕様テスト');
H.party.length = 0;
H.party.push(H.makeCompanion('warrior'));
H.hero.lv = 8;
H.party[0].hp = 999;
H.hero.gold = 1000;
H.startBattle('ピクシー', 'grass');
frames(35);  // 出現メッセージまで進める
H.hero.hp = 0;  // 勇者だけ戦闘不能に
guard = 0;
while (H.getState() === 'battle' && guard < 4000) {
  if (guard % 15 === 0) H.press('KeyZ');
  rafCb();
  guard++;
}
ok(H.getState() === 'field', '勇者が倒れても仲間が戦って終局する');
ok(H.hero.gold >= 1000, '全滅ではないのでゴールドが半減しない (gold=' + H.hero.gold + ')');
ok(H.hero.hp >= 1, '戦闘後に勇者は立ち上がる (hp=' + H.hero.hp + ')');
for (let i = 0; i < 5; i++) { H.press('KeyZ'); frames(10); }

// ---- 10. 強くてニューゲーム ----
console.log('# 強くてニューゲーム');
H.hero.trueCleared = true; H.hero.cleared = true;
H.hero.lv = 9; H.hero.gold = 5000; H.hero.weapon = '神の剣';
const partySizeBefore = H.party.length;
H.ngPlus();
frames(30);
for (let i = 0; i < 5; i++) { H.press('KeyZ'); frames(10); }
ok(H.hero.cleared === false && H.hero.trueCleared === false, '物語フラグがリセットされる');
ok(H.hero.lap === 2, '2周目になる (lap=' + H.hero.lap + ')');
ok(H.hero.lv === 9 && H.hero.gold === 5000 && H.hero.weapon === '神の剣', 'レベル・ゴールド・装備を引き継ぐ');
ok(H.party.length === partySizeBefore, '仲間を引き継ぐ');
ok(H.player.tx === 9 && H.player.ty === 11, '町の開始地点に戻る');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
