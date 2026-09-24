// Student page: join a game with a code and play from any device. No account needed.
import { configured, auth, db, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, updateDoc, onSnapshot,
  AVATARS, LETTERS, COLORS, esc, ls, clone, toast, rankList, errMsg, beep, confetti, notConfiguredHTML } from './common.js';

const app = document.getElementById('app');
const urlCode = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g, '').slice(0, 6);
const saved = ls.get('bb:player', null);
const S = { uid: null, authErr: '', view: 'join', joinCode: urlCode, joinName: saved ? saved.name : '',
  joinAvatar: saved ? saved.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)], joinErr: '', busy: false };
let P = null;

function render() { if (S.view === 'player') return fullPlayer(); app.innerHTML = viewJoin(); }

function viewJoin() {
  const ready = configured && S.uid;
  return `<main class="wrap"><header class="hero"><h1 class="brand">Buzzb<span class="bolt">⚡</span>ard</h1>
    <p class="tagline">Type the code from the big screen and get ready to play.</p></header>
    ${!configured ? notConfiguredHTML('student') : S.authErr ? `<div class="notice err">${esc(S.authErr)}</div>` : !S.uid ? `<p class="muted" style="text-align:center">Connecting…</p>` : ''}
    <section class="card join-solo" aria-labelledby="joinH" style="margin-top:1rem">
      <h2 id="joinH">Join a game</h2>
      <label><span>Game code</span><input class="code-input" data-bind="joinCode" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="000000" value="${esc(S.joinCode)}"></label>
      <label><span>Nickname</span><input data-bind="joinName" maxlength="16" autocomplete="off" placeholder="What should we call you?" value="${esc(S.joinName)}"></label>
      <p style="font-weight:700;margin-bottom:.35rem">Pick your buddy</p>
      <div class="avatars">${AVATARS.map(a => `<button type="button" class="av ${a === S.joinAvatar ? 'on' : ''}" data-act="pickAv" data-v="${a}" aria-pressed="${a === S.joinAvatar}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div>
      ${S.joinErr ? `<p class="err" role="alert">${esc(S.joinErr)}</p>` : ''}
      <button class="btn primary big" style="width:100%" data-act="join" ${!ready || S.busy ? 'disabled' : ''}>${S.busy ? 'Joining…' : 'Join game'}</button>
    </section>
    <p class="foot muted">Teacher? <a href="host.html">Open the host page</a></p></main>`;
}

async function doJoin() {
  const code = (S.joinCode || '').replace(/\D/g, ''), name = (S.joinName || '').trim().slice(0, 16), avatar = S.joinAvatar;
  const fail = m => { S.joinErr = m; S.busy = false; render(); };
  if (code.length !== 6) return fail('Enter the 6-digit code from the big screen.');
  if (!name) return fail('Pick a nickname so your teacher can spot you.');
  S.busy = true; S.joinErr = ''; render();
  try {
    const g = await getDoc(doc(db, 'games', code));
    if (!g.exists()) return fail('No game uses that code. Double-check the big screen.');
    if (g.data().status === 'ended') return fail('That game has already finished.');
    const ref = doc(db, 'games', code, 'players', S.uid);
    const cur = await getDoc(ref);
    if (cur.exists()) await updateDoc(ref, { name, avatar });
    else await setDoc(ref, { name, avatar, joinedAt: Date.now(), answers: {} });
    ls.set('bb:player', { code, name, avatar }); S.busy = false;
    startPlaying(code, name, avatar, cur.exists() ? clone(cur.data().answers || {}) : {});
  } catch (e) { fail(errMsg(e)); }
}

function startPlaying(code, name, avatar, answers) {
  stopPlaying();
  P = { code, name, avatar, answers: { ...answers }, game: null, lastKey: null, tick: null, missing: false, confettiDone: false, qStart: 0 };
  S.view = 'player';
  if (history.replaceState) history.replaceState(null, '', location.pathname);
  P.un = onSnapshot(doc(db, 'games', code), s => { if (!P) return; P.game = s.exists() ? s.data() : null; P.missing = !s.exists(); renderPlayer(); },
    e => toast(errMsg(e)));
  render();
}
function stopPlaying() { if (!P) return; clearInterval(P.tick); P.un && P.un(); P = null; }
function renderPlayer() {
  if (!P) return; const g = P.game; const key = g ? g.status + ':' + g.qIndex : (P.missing ? 'gone' : 'none');
  if (key !== P.lastKey) { P.lastKey = key; fullPlayer(); }
}
function fullPlayer() {
  if (!P) return; clearInterval(P.tick);
  const g = P.game, r = g && g.results && g.results[S.uid];
  let body;
  if (!g) body = `<div class="p-center">${P.missing ? `<h2>This game was closed</h2><button class="btn" data-act="leave">Back to start</button>` : `<p>Connecting…</p>`}</div>`;
  else if (g.status === 'lobby') body = `<div class="p-center"><div class="big-av">${esc(P.avatar)}</div><h2>You're in, ${esc(P.name)}!</h2><p>Look for your name on the big screen. The quiz starts when your teacher is ready.</p></div>`;
  else if (g.status === 'question') body = playerQuestion(g);
  else if (g.status === 'reveal' || g.status === 'board') body = playerResult(g, r);
  else body = playerFinal(g, r);
  app.innerHTML = `<main class="player"><div class="pbar"><span class="me"><span class="e">${esc(P.avatar)}</span>${esc(P.name)}</span><span class="spacer"></span>
    ${r ? `<span class="pill">${r.score} pts</span>` : ''}<button class="btn small" data-act="leave">${g && g.status === 'ended' ? 'Done' : 'Leave'}</button></div>${body}</main>`;
  if (g && g.status === 'question' && P.answers[g.qIndex] == null) playerTimer(g);
  if (g && g.status === 'ended' && r && !P.confettiDone) { P.confettiDone = true; const pl = rankList(g.results).findIndex(x => x.id === S.uid); if (pl >= 0 && pl < 3) confetti(); }
}
const qStartKey = g => 'bb:qs:' + P.code + ':' + g.qIndex + ':' + g.startedAt;
function playerQuestion(g) {
  const i = g.qIndex, q = g.question, mine = P.answers[i];
  if (mine) return `<div class="p-center"><div class="locked" style="background:${COLORS[mine.c]}">${LETTERS[mine.c]}</div><h2>Locked in</h2><p>Eyes on the big screen while everyone else answers.</p></div>`;
  let st = ls.get(qStartKey(g), null); if (!st) { st = Date.now(); ls.set(qStartKey(g), st); } P.qStart = st;
  return `<p class="muted" style="text-align:center;margin:0;font-weight:700">Question ${i + 1} of ${g.total}</p><h2 class="p-q">${esc(q.text)}</h2>
    <div class="p-timer"><i id="ptf" style="width:100%"></i></div>
    <div class="choices p-choices" id="pch">${q.choices.map((c, ci) => `<button class="choice" style="--cc:${COLORS[ci]}" data-act="answer" data-c="${ci}"><span class="letter">${LETTERS[ci]}</span><span class="ctext">${esc(c)}</span></button>`).join('')}</div>`;
}
function playerTimer(g) {
  const lim = g.question.time * 1000;
  const upd = () => {
    const left = Math.max(0, lim - (Date.now() - P.qStart)); const f = document.getElementById('ptf'); if (f) f.style.width = (100 * left / lim) + '%';
    if (left <= 0) { clearInterval(P.tick); const ch = document.getElementById('pch'); if (ch) ch.outerHTML = `<div class="p-center"><h2>Time's up</h2><p>Waiting for the answer…</p></div>`; }
  };
  upd(); P.tick = setInterval(upd, 100);
}
async function answer(c) {
  const g = P.game; if (!g || g.status !== 'question') return; const i = g.qIndex; if (P.answers[i] != null) return;
  const lim = g.question.time * 1000, el = Date.now() - P.qStart; if (el > lim + 800) return;
  const ms = Math.max(0, Math.min(lim, el)); P.answers[i] = { c, ms }; fullPlayer(); beep(600, .08);
  try { await updateDoc(doc(db, 'games', P.code, 'players', S.uid), { ['answers.' + i]: { c, ms } }); }
  catch (e) { delete P.answers[i]; toast(errMsg(e)); fullPlayer(); }
}
function playerResult(g, r) {
  if (!r) return `<div class="p-center"><h2>Get ready</h2><p>You'll be scored from the next question.</p></div>`;
  const ranked = rankList(g.results), pos = ranked.findIndex(x => x.id === S.uid) + 1, ct = g.question.choices[g.correct];
  const v = r.correct ? `<div class="verdict good"><h2>Correct!</h2><p class="pts">+${r.last}</p>${r.streak >= 2 ? `<p style="margin:.3rem 0 0;font-weight:700">🔥 ${r.streak} in a row</p>` : ''}</div>`
    : `<div class="verdict ${r.answered ? 'bad' : 'none'}"><h2>${r.answered ? 'Not this time' : 'Too slow!'}</h2><p style="margin:0;font-weight:700">The answer was ${LETTERS[g.correct]}: ${esc(ct)}</p></div>`;
  return `<div class="p-center">${v}<p class="rankline">You're <b>#${pos}</b> of ${ranked.length}</p>
    ${pos > 1 ? `<p class="muted">${ranked[pos - 2].score - r.score + 1} points to pass ${esc(ranked[pos - 2].name)}</p>` : `<p class="muted">You're leading. Keep it up!</p>`}</div>`;
}
function playerFinal(g, r) {
  if (!r) return `<div class="p-center"><h2>Game over</h2><p>Thanks for joining!</p></div>`;
  const ranked = rankList(g.results), pos = ranked.findIndex(x => x.id === S.uid) + 1, ok = (r.perQ || []).filter(a => a && a.ok).length;
  const medal = ['🥇','🥈','🥉'][pos - 1] || '🎉';
  return `<div class="p-center"><div class="big-av">${medal}</div><h2 style="font-size:2.2rem">${pos <= 3 ? `You placed #${pos}!` : `You finished #${pos}`}</h2>
    <p class="rankline"><b>${r.score}</b> points, ${ok} of ${g.total} correct</p><p class="muted">out of ${ranked.length} players</p></div>`;
}

const A = {
  pickAv(el) { S.joinAvatar = el.dataset.v; render(); },
  join: doJoin,
  answer(el) { answer(+el.dataset.c); },
  leave() { const g = P && P.game; if (g && g.status === 'ended') ls.del('bb:player'); stopPlaying(); S.view = 'join'; S.joinCode = ''; render(); }
};
document.addEventListener('click', ev => { const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return; const f = A[el.dataset.act]; if (f) { ev.preventDefault(); f(el, ev); } });
document.addEventListener('input', ev => { const t = ev.target; if (!t.dataset.bind) return;
  if (t.dataset.bind === 'joinCode') { S.joinCode = t.value.replace(/\D/g, '').slice(0, 6); if (t.value !== S.joinCode) t.value = S.joinCode; }
  else S[t.dataset.bind] = t.value; });
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && S.view === 'join' && ev.target.dataset && ev.target.dataset.bind) doJoin(); });

async function resume() {
  const p = ls.get('bb:player', null);
  if (!p || (urlCode && urlCode !== p.code)) return false;
  try {
    const g = await getDoc(doc(db, 'games', p.code));
    if (!g.exists() || g.data().status === 'ended') return false;
    const me = await getDoc(doc(db, 'games', p.code, 'players', S.uid));
    if (!me.exists()) return false;
    startPlaying(p.code, p.name, p.avatar, clone(me.data().answers || {})); return true;
  } catch { return false; }
}

render();
if (configured) {
  let started = false;
  onAuthStateChanged(auth, async u => {
    if (u) { S.uid = u.uid; S.authErr = ''; if (!started) { started = true; if (await resume()) return; } if (S.view === 'join') render(); }
    else signInAnonymously(auth).catch(e => { S.authErr = errMsg(e); render(); });
  });
}
