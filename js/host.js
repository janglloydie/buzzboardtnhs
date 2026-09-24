// Teacher page: sign in, import quizzes from XML, host live games, and review past scores.
import { configured, auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, getDocs,
  LETTERS, COLORS, esc, rid, ls, clone, fmtCode, fmtDate, toast, rankList, errMsg, sound, beep, chime, confetti, notConfiguredHTML } from './common.js';

const app = document.getElementById('app');
const S = { user: null, authReady: false, view: 'login', email: '', password: '', loginErr: '', busy: false,
  quizzes: null, games: null, importText: '', importResult: null, detail: null, confirm: null, modal: null };
let H = null;
const hErr = e => errMsg(e, 'host');

/* ---------- teacher's private data ---------- */
const Priv = {
  quizCol() { return collection(db, 'teachers', S.user.uid, 'quizzes'); },
  histCol() { return collection(db, 'teachers', S.user.uid, 'history'); },
  async listQuizzes() { const s = await getDocs(this.quizCol()); return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
  async saveQuiz(q) { const id = q.id || ('qz' + rid(10)); await setDoc(doc(this.quizCol(), id), { title: q.title, questions: q.questions, updatedAt: Date.now() }); return id; },
  async deleteQuiz(id) { await deleteDoc(doc(this.quizCol(), id)); },
  async listGames() { const s = await getDocs(this.histCol()); return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); },
  async getGame(code) { const s = await getDoc(doc(this.histCol(), code)); return s.exists() ? s.data() : null; },
  async saveGame(code, patch) { await setDoc(doc(this.histCol(), code), patch, { merge: true }); },
  async deleteGame(code) { await deleteDoc(doc(this.histCol(), code)); }
};

/* ---------- XML ---------- */
const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<quiz title="Solar System Warm-up">
  <question time="20">
    <text>Which planet is closest to the Sun?</text>
    <choice correct="true">Mercury</choice>
    <choice>Venus</choice>
    <choice>Earth</choice>
    <choice>Mars</choice>
  </question>
  <question time="15">
    <text>How many moons does Earth have?</text>
    <choice>None</choice>
    <choice correct="true">One</choice>
    <choice>Two</choice>
  </question>
  <question time="20">
    <text>Which planet is famous for its rings?</text>
    <choice>Jupiter</choice>
    <choice correct="true">Saturn</choice>
    <choice>Neptune</choice>
    <choice>Mercury</choice>
  </question>
</quiz>`;
function kidText(el, names) { for (const ch of el.children) if (names.includes(ch.tagName.toLowerCase())) return ch.textContent.trim(); return ''; }
function parseXML(text) {
  const errors = [], quizzes = [];
  if (!text.trim()) return { errors: ['Paste some XML or choose a file first.'], quizzes };
  const d = new DOMParser().parseFromString(text.trim(), 'application/xml');
  const pe = d.getElementsByTagName('parsererror')[0];
  if (pe) { const line = (pe.textContent || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' ');
    return { errors: ['The XML has a syntax error, often a missing closing tag or an unescaped & (write it as &amp;amp;). ' + line], quizzes }; }
  let qEls = [...d.getElementsByTagName('quiz')]; if (!qEls.length) qEls = [d.documentElement];
  qEls.forEach((qe, qi) => {
    const title = (qe.getAttribute('title') || kidText(qe, ['title', 'name']) || `Imported quiz ${qi + 1}`).trim().slice(0, 80);
    const tag = qEls.length > 1 ? `“${title}”, ` : '';
    const questions = [];
    [...qe.getElementsByTagName('question')].forEach((q, i) => {
      const where = `${tag}question ${i + 1}`;
      const qt = (q.getAttribute('text') || kidText(q, ['text', 'prompt', 'q'])).replace(/\s+/g, ' ').trim();
      const chEls = [...q.children].filter(c => ['choice', 'option', 'answer'].includes(c.tagName.toLowerCase()));
      const choices = chEls.map(c => c.textContent.replace(/\s+/g, ' ').trim());
      let correct = chEls.findIndex(c => /^(true|yes|1|correct)$/i.test((c.getAttribute('correct') || '').trim()));
      const ansAttr = (q.getAttribute('answer') || '').trim();
      if (correct < 0 && ansAttr) { const L = LETTERS.indexOf(ansAttr.toUpperCase()); correct = L >= 0 ? L : (parseInt(ansAttr, 10) - 1); }
      let t = parseInt(q.getAttribute('time') || q.getAttribute('seconds') || '20', 10); if (!Number.isFinite(t)) t = 20; t = Math.max(5, Math.min(120, t));
      if (!qt) { errors.push(`${where}: missing the question text (add <text>…</text>).`); return; }
      if (choices.length < 2 || choices.length > 4) { errors.push(`${where}: needs 2 to 4 <choice> elements (found ${choices.length}).`); return; }
      if (choices.some(c => !c)) { errors.push(`${where}: one of the choices is empty.`); return; }
      if (!(correct >= 0 && correct < choices.length)) { errors.push(`${where}: mark the right answer with correct="true".`); return; }
      questions.push({ text: qt.slice(0, 300), choices: choices.map(c => c.slice(0, 120)), correct, time: t });
    });
    if (!questions.length && !errors.length) errors.push(`${tag}No <question> elements found.`);
    if (questions.length) quizzes.push({ title, questions });
  });
  return { errors, quizzes };
}
function toXML(q) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<quiz title="${x(q.title)}">\n` + q.questions.map(qq => `  <question time="${qq.time}">\n    <text>${x(qq.text)}</text>\n` +
    qq.choices.map((c, i) => `    <choice${i === qq.correct ? ' correct="true"' : ''}>${x(c)}</choice>`).join('\n') + `\n  </question>`).join('\n') + `\n</quiz>`;
}

/* ---------- views ---------- */
function render() {
  if (S.view === 'host') return fullHost();
  const v = { login: viewLogin, library: viewLibrary, import: viewImport, history: viewHistory, detail: viewDetail }[S.view] || viewLogin;
  app.innerHTML = v() + modalHTML();
}
function modalHTML() {
  if (!S.modal) return '';
  return `<div class="modal-back" data-act="closeModal"><div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(S.modal.title)}" data-stop>
    <div class="row"><h2 style="margin:0">${esc(S.modal.title)}</h2><span class="spacer"></span><button class="btn small" data-act="closeModal">Close</button></div>
    <p class="muted" style="margin-top:.6rem">${esc(S.modal.note || '')}</p>
    <textarea class="mono" rows="14" readonly id="modalText">${esc(S.modal.text)}</textarea>
    <div class="row" style="margin-top:.8rem"><button class="btn primary" data-act="copyModal">Copy to clipboard</button></div></div></div>`;
}
function viewLogin() {
  return `<main class="wrap"><header class="hero"><h1 class="brand">Buzzb<span class="bolt">⚡</span>ard</h1><p class="tagline">Teacher sign-in</p></header>
    ${!configured ? notConfiguredHTML('host') : !S.authReady ? `<p class="muted" style="text-align:center">Connecting…</p>` : `
    <section class="card login" aria-labelledby="lh"><h2 id="lh">Sign in to host</h2>
      <label><span>Email</span><input type="email" data-bind="email" autocomplete="username" value="${esc(S.email)}"></label>
      <label><span>Password</span><input type="password" data-bind="password" autocomplete="current-password" value="${esc(S.password)}"></label>
      ${S.loginErr ? `<p class="err" role="alert">${esc(S.loginErr)}</p>` : ''}
      <button class="btn primary big" style="width:100%" data-act="login" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Signing in…' : 'Sign in'}</button>
      <p style="margin:1rem 0 0;text-align:center"><button class="btn small" data-act="reset">Send a password reset email</button></p>
    </section>`}
    <p class="foot muted">Student? <a href="index.html">Join a game instead</a></p></main>`;
}
function libTop(title, extra = '') {
  return `<div class="topbar">${extra}<h1>${title}</h1><span class="spacer"></span></div>`;
}
function viewLibrary() {
  const qs = S.quizzes;
  const list = qs == null ? `<p class="muted">Loading your quizzes…</p>` : !qs.length ? `<div class="card empty"><div class="emoji">📥</div>
    <h2>Import your first quiz</h2><p>In Buzzboard on Claude, open a quiz, tap View XML, copy it, and paste it here. Any XML in the same format works too.</p>
    <div class="row" style="justify-content:center"><button class="btn primary" data-act="goImport">Import XML</button></div></div>`
    : `<div class="quiz-list">${qs.map(q => `<div class="card quiz-item"><div style="flex:1;min-width:12rem"><h3>${esc(q.title)}</h3>
      <p class="muted" style="margin:0">${q.questions.length} question${q.questions.length === 1 ? '' : 's'}</p></div>
      <div class="row"><button class="btn primary" data-act="host" data-id="${q.id}">Host live</button>
      <button class="btn small" data-act="exportQuiz" data-id="${q.id}">View XML</button>
      <button class="btn small danger" data-act="delQuiz" data-id="${q.id}">${S.confirm === 'q:' + q.id ? 'Tap again to delete' : 'Delete'}</button></div></div>`).join('')}</div>`;
  return `<main class="wrap"><div class="topbar"><h1>My quizzes</h1><span class="spacer"></span>
    <button class="btn small" data-act="goHistory">Past games</button><button class="btn small primary" data-act="goImport">Import XML</button>
    <button class="btn small" data-act="logout">Sign out</button></div>
    <p class="muted">Signed in as ${esc(S.user.email)}</p>${list}</main>`;
}
function viewImport() {
  const r = S.importResult;
  return `<main class="wrap"><div class="topbar"><button class="btn small" data-act="goLibrary">Back</button><h1>Import from XML</h1></div>
  <div class="card">
    <label><span>Paste XML</span><textarea class="mono" data-bind="importText" rows="14" spellcheck="false" placeholder="<quiz title=&quot;…&quot;> … </quiz>">${esc(S.importText)}</textarea></label>
    <div class="row"><label class="btn small" style="margin:0">Choose .xml file<input type="file" accept=".xml,text/xml,application/xml,.txt" data-act-change="xmlFile" style="display:none"></label>
      <button class="btn small" data-act="useTemplate">Fill in the example</button><span class="spacer"></span>
      <button class="btn primary" data-act="checkXML">Check XML</button></div>
  </div>
  ${r ? `<div class="card" style="margin-top:1.25rem" aria-live="polite">
    ${r.errors.length ? `<h3 class="err">${r.errors.length} problem${r.errors.length > 1 ? 's' : ''} to fix</h3><ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${r.quizzes.map(q => `<h3 style="margin-top:.5rem">${esc(q.title)} <span class="muted" style="font-weight:600;font-size:1rem">${q.questions.length} questions</span></h3>
      ${q.questions.slice(0, 5).map((qq, i) => `<div class="preview-q"><b>${i + 1}. ${esc(qq.text)}</b> <span class="muted">(${qq.time}s)</span><br>
        ${qq.choices.map((c, j) => `<span class="${j === qq.correct ? 'ok-choice' : ''}">${LETTERS[j]}. ${esc(c)}${j === qq.correct ? ' ✓' : ''}</span>`).join(' &nbsp; ')}</div>`).join('')}
      ${q.questions.length > 5 ? `<p class="muted">and ${q.questions.length - 5} more…</p>` : ''}`).join('')}
    ${r.quizzes.length ? `<div class="row" style="margin-top:1rem"><button class="btn primary" data-act="saveImport">Save ${r.quizzes.length > 1 ? r.quizzes.length + ' quizzes' : 'quiz'}${r.errors.length ? ' (skip broken questions)' : ''}</button></div>` : ''}
  </div>` : ''}
  <details class="card" style="margin-top:1.25rem"><summary>XML format guide</summary>
    <p style="margin-top:.8rem">Wrap everything in <code>&lt;quiz title="…"&gt;</code>. Each <code>&lt;question&gt;</code> has a <code>&lt;text&gt;</code> and 2 to 4 <code>&lt;choice&gt;</code> elements; add <code>correct="true"</code> to the right one. The optional <code>time</code> attribute sets seconds (5 to 120, default 20).</p>
    <p>Also accepted: <code>&lt;option&gt;</code> or <code>&lt;answer&gt;</code> instead of <code>&lt;choice&gt;</code>, an <code>answer="B"</code> attribute on the question, and several <code>&lt;quiz&gt;</code> elements inside one <code>&lt;quizzes&gt;</code> root.</p>
    <pre class="mono" style="overflow-x:auto;background:var(--field);border:3px solid var(--line);border-radius:12px;padding:.8rem">${esc(TEMPLATE)}</pre>
  </details></main>`;
}
function viewHistory() {
  const gs = S.games;
  return `<main class="wrap"><div class="topbar"><button class="btn small" data-act="goLibrary">Back</button><h1>Past games</h1></div>
  ${gs == null ? `<p class="muted">Loading…</p>` : !gs.length ? `<div class="card empty"><div class="emoji">🏁</div><h2>No games yet</h2><p>Host a quiz and its scores will land here.</p></div>`
  : `<div class="quiz-list">${gs.map(g => { const n = Object.keys(g.results || {}).length; return `<div class="card quiz-item"><div style="flex:1;min-width:12rem">
    <h3>${esc(g.title)}</h3><p class="muted" style="margin:0">${fmtDate(g.createdAt)}, ${n} player${n === 1 ? '' : 's'}, code ${fmtCode(g.id)}${g.status === 'ended' ? '' : ', not finished'}</p></div>
    <div class="row"><button class="btn small primary" data-act="openGame" data-id="${g.id}">See scores</button>
    <button class="btn small danger" data-act="delGame" data-id="${g.id}">${S.confirm === 'g:' + g.id ? 'Tap again to delete' : 'Delete'}</button></div></div>`; }).join('')}</div>`}</main>`;
}
function viewDetail() {
  const g = S.detail;
  return `<main class="wrap"><div class="topbar"><button class="btn small" data-act="goHistory">Back</button><h1>${esc(g.title)}</h1></div>
    <p class="muted">${fmtDate(g.createdAt)}, code ${fmtCode(g.id)}</p>${resultsHTML(g.questions, g.results)}</main>`;
}
function resultsHTML(questions, results) {
  const ranked = rankList(results), n = questions.length;
  if (!ranked.length) return `<div class="card empty"><p>Nobody played this one.</p></div>`;
  const acc = questions.map((q, i) => { let ok = 0, tot = 0; for (const r of ranked) { const a = (r.perQ || [])[i]; if (a) { tot++; if (a.ok) ok++; } } return { q, ok, tot }; });
  return `<div class="section"><div class="row"><h2 style="margin:0">Scores</h2><span class="spacer"></span><button class="btn small" data-act="csv">Download CSV</button></div>
    <div class="tbl-wrap" style="margin-top:.8rem"><table><thead><tr><th class="num">#</th><th>Player</th><th class="num">Score</th><th class="num">Correct</th></tr></thead><tbody>
    ${ranked.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.avatar)} ${esc(r.name)}</td><td class="num">${r.score}</td><td class="num">${(r.perQ || []).filter(a => a && a.ok).length} / ${n}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="section"><h2>How each question went</h2><div class="card acc-list">
    ${acc.map((a, i) => { const pct = a.tot ? Math.round(100 * a.ok / a.tot) : 0; return `<div class="acc"><div><b>${i + 1}.</b> ${esc(a.q.text)} <span class="muted">(${LETTERS[a.q.correct]}: ${esc(a.q.choices[a.q.correct])})</span></div>
      <div class="bar" role="img" aria-label="${pct}% correct"><i style="width:${pct}%"></i></div><div style="text-align:right;font-weight:700">${a.tot ? pct + '%' : 'n/a'}</div></div>`; }).join('')}
    </div></div>`;
}
function downloadCSV(title, questions, results) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Rank', 'Name', 'Score', 'Correct', ...questions.map((_, i) => `Q${i + 1} answer`), ...questions.map((_, i) => `Q${i + 1} points`)];
  const rows = rankList(results).map((r, i) => { const pq = r.perQ || []; return [i + 1, r.name, r.score, pq.filter(a => a && a.ok).length,
    ...questions.map((_, k) => pq[k] && pq[k].c != null ? LETTERS[pq[k].c] : ''), ...questions.map((_, k) => pq[k] ? pq[k].pts : 0)]; });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\n');
  const name = (title || 'quiz').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'quiz';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${name}-scores.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- live hosting ---------- */
const gameRef = code => doc(db, 'games', code);
async function hostQuiz(quiz) {
  let code = null;
  for (let t = 0; t < 6; t++) { const c = String(100000 + Math.floor(Math.random() * 900000)); const g = await getDoc(gameRef(c)); if (!g.exists()) { code = c; break; } }
  if (!code) throw new Error('code');
  const questions = clone(quiz.questions), now = Date.now();
  await Priv.saveGame(code, { title: quiz.title, questions, createdAt: now, status: 'live', results: {} });
  await setDoc(gameRef(code), { code, title: quiz.title, hostUid: S.user.uid, status: 'lobby', qIndex: -1, total: questions.length,
    question: null, correct: null, dist: null, results: {}, createdAt: now, startedAt: 0 });
  ls.set('bb:host', { code, uid: S.user.uid });
  startHosting(code, questions, quiz.title);
}
function startHosting(code, questions, title) {
  stopHosting();
  H = { code, questions, title, game: null, players: {}, lastKey: null, tick: null, q: Promise.resolve(), revealedFor: -1, confettiDone: false };
  S.view = 'host'; S.confirm = null;
  H.unG = onSnapshot(gameRef(code), s => { if (!H) return; H.game = s.exists() ? s.data() : null; renderHost(); }, e => toast(hErr(e)));
  H.unP = onSnapshot(collection(db, 'games', code, 'players'), s => { if (!H) return; H.players = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); renderHost(true); }, e => toast(hErr(e)));
  render();
}
function stopHosting() { if (!H) return; clearInterval(H.tick); H.unG && H.unG(); H.unP && H.unP(); H = null; }
function gameWrite(patch) { H.q = H.q.then(() => updateDoc(gameRef(H.code), patch)).catch(e => { console.error(e); toast(hErr(e)); }); return H.q; }
function joinURL() { return new URL('./?code=' + H.code, location.href).href; }
function renderHost(fromPlayers) {
  if (!H || S.view !== 'host') return; const g = H.game; const key = g ? g.status + ':' + g.qIndex : 'none';
  if (key !== H.lastKey) { H.lastKey = key; fullHost(); return; }
  if (!g) return;
  if (g.status === 'lobby') { const el = document.getElementById('chips'); if (el) { el.innerHTML = chipsHTML(); document.getElementById('pcount').textContent = Object.keys(H.players).length;
    document.getElementById('startBtn').disabled = !Object.keys(H.players).length; } }
  if (g.status === 'question') { const { n, tot } = answeredCount(); const a = document.getElementById('ansCount'); if (a) { a.textContent = n; document.getElementById('ansTotal').textContent = tot; }
    if (fromPlayers && tot > 0 && n >= tot) reveal(); }
}
function answeredCount() { const i = H.game.qIndex; const ps = Object.values(H.players); return { n: ps.filter(p => p.answers && p.answers[i]).length, tot: ps.length }; }
function chipsHTML() {
  const ps = Object.values(H.players).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  return ps.length ? ps.map(p => `<span class="chip"><span class="e">${esc(p.avatar)}</span>${esc(p.name)}</span>`).join('') : `<p class="muted">Waiting for players to join…</p>`;
}
function hostBar(g) {
  return `<div class="hbar"><span class="mini-brand">Buzzboard ⚡</span><span class="pill">${esc(H.title)}</span>
  ${g && g.status !== 'lobby' ? `<span class="pill">Code ${fmtCode(H.code)}</span>` : ''}<span class="spacer"></span>
  <button class="btn small" data-act="toggleSound" aria-pressed="${sound.on}">${sound.on ? 'Sound on' : 'Sound off'}</button>
  ${g && g.status !== 'ended' ? `<button class="btn small danger" data-act="endGame">${S.confirm === 'end' ? 'Tap again to end' : 'End game'}</button>` : ''}</div>`;
}
function tilesHTML(q, g, rev) {
  return `<div class="choices">${q.choices.map((c, i) => { const cls = rev ? (i === g.correct ? 'right' : 'dim') : '';
    return `<div class="choice ${cls}" style="--cc:${COLORS[i]}"><span class="letter">${LETTERS[i]}</span><span class="ctext">${esc(c)}</span>${rev && g.dist ? `<span class="count">${g.dist[i] || 0}</span>` : ''}</div>`; }).join('')}</div>`;
}
function fullHost() {
  if (!H) return; clearInterval(H.tick); const g = H.game;
  if (!g) { app.innerHTML = `<main class="host-screen">${hostBar(null)}<p>Loading the game…</p></main>`; return; }
  let body = ''; const i = g.qIndex, q = H.questions[i], n = H.questions.length;
  if (g.status === 'lobby') { const np = Object.keys(H.players).length; const url = joinURL();
    body = `<section class="lobby"><div class="card code-block"><p style="font-weight:700;font-size:1.2rem">Join with this code</p><div class="bigcode">${fmtCode(H.code)}</div>
      <div class="qr" id="qr" aria-label="QR code for the join link"></div>
      <p class="muted" style="margin:0">Scan, or go to</p><p class="join-url">${esc(url.replace(/\?code=\d+$/, '').replace(/^https?:\/\//, ''))}</p></div>
      <div><h2 style="font-size:2rem"><span id="pcount">${np}</span> players in the lobby</h2><div class="chips" id="chips">${chipsHTML()}</div>
      <div class="h-actions" style="justify-content:flex-start"><button class="btn primary big" id="startBtn" data-act="hStart" ${np ? '' : 'disabled'}>Start the quiz</button></div></div></section>`; }
  else if (g.status === 'question') { const { n: an, tot } = answeredCount();
    body = `<div class="q-top"><span class="stat">Question ${i + 1} of ${n}</span>
      <div class="ring" id="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"/><circle class="arc" id="arc" cx="50" cy="50" r="42" stroke-dasharray="263.9" stroke-dashoffset="0"/></svg><span class="num" id="ringNum">${q.time}</span></div>
      <span class="stat"><span id="ansCount">${an}</span> of <span id="ansTotal">${tot}</span> answered</span></div>
      <h1 class="q-text">${esc(q.text)}</h1>${tilesHTML(q, g, false)}
      <div class="h-actions"><button class="btn" data-act="hReveal">Reveal now</button></div>`; }
  else if (g.status === 'reveal') {
    body = `<div class="q-top"><span class="stat">Question ${i + 1} of ${n}</span></div><h1 class="q-text">${esc(q.text)}</h1>${tilesHTML(q, g, true)}
      <div class="h-actions"><button class="btn primary big" data-act="hBoard">Show leaderboard</button></div>`; }
  else if (g.status === 'board') {
    body = `<h1 class="board-title">${i + 1 < n ? 'Leaderboard' : 'Final standings'}</h1><div class="board" id="board"></div>
      <div class="h-actions"><button class="btn primary big" data-act="hNext">${i + 1 < n ? 'Next question' : 'Show the winners'}</button></div>`; }
  else if (g.status === 'ended') { const top = rankList(g.results).slice(0, 3);
    const pod = (r, p) => r ? `<div class="pod p${p}"><div class="e">${esc(r.avatar)}</div><div class="n">${esc(r.name)}</div><div class="block"><span class="place">${p}</span><span>${r.score}</span></div></div>` : `<div class="pod p${p}"></div>`;
    body = `<h1 class="board-title">${top.length ? 'Winners' : 'Game over'}</h1>${top.length ? `<div class="podium">${pod(top[1], 2)}${pod(top[0], 1)}${pod(top[2], 3)}</div>` : ''}
      <div class="wrap" style="padding:0;width:100%">${resultsHTML(H.questions, g.results)}
      <div class="h-actions"><button class="btn primary" data-act="hExit">Back to my quizzes</button></div></div>`; }
  app.innerHTML = `<main class="host-screen">${hostBar(g)}${body}</main>`;
  if (g.status === 'lobby') drawQR();
  if (g.status === 'question') runTimer();
  if (g.status === 'board') animateBoard(g);
  if (g.status === 'ended' && !H.confettiDone) { H.confettiDone = true; if (Object.keys(g.results || {}).length) { confetti(); chime(); } }
}
function drawQR(tries = 0) {
  const el = document.getElementById('qr'); if (!el) return;
  if (!window.QRCode) { if (tries < 20) setTimeout(() => drawQR(tries + 1), 250); else el.remove(); return; }
  el.innerHTML = ''; try { new window.QRCode(el, { text: joinURL(), width: 170, height: 170, correctLevel: window.QRCode.CorrectLevel.M }); } catch { el.remove(); }
}
function runTimer() {
  clearInterval(H.tick); const g = H.game, q = H.questions[g.qIndex]; const end = (g.startedAt || Date.now()) + q.time * 1000; let lastSec = null;
  const upd = () => {
    if (!H || !H.game || H.game.status !== 'question') { clearInterval(H && H.tick); return; }
    const left = Math.max(0, end - Date.now()), sec = Math.ceil(left / 1000);
    const arc = document.getElementById('arc'), num = document.getElementById('ringNum'), ring = document.getElementById('ring');
    if (arc) { arc.style.strokeDashoffset = String(263.9 * (1 - left / (q.time * 1000))); num.textContent = sec; ring.classList.toggle('hot', sec <= 5); }
    if (sec !== lastSec) { if (sec <= 5 && sec > 0) beep(880, .07, 'square', .04); lastSec = sec; }
    if (left <= 0) { clearInterval(H.tick); reveal(); }
  };
  upd(); H.tick = setInterval(upd, 100);
}
async function startQuestion(i) {
  const q = H.questions[i];
  await gameWrite({ status: 'question', qIndex: i, question: { text: q.text, choices: q.choices, time: q.time }, correct: null, dist: null, startedAt: Date.now() });
}
async function reveal() {
  const g = H && H.game; if (!g || g.status !== 'question') return; const i = g.qIndex; if (H.revealedFor === i) return; H.revealedFor = i; clearInterval(H.tick);
  const q = H.questions[i], prev = g.results || {}, results = { ...clone(prev) }, dist = q.choices.map(() => 0), limit = q.time * 1000;
  for (const [pid, p] of Object.entries(H.players)) {
    const pr = prev[pid] || { score: 0, streak: 0, perQ: [] }; const a = p.answers && p.answers[i];
    const answered = !!a && Number.isInteger(a.c) && a.c >= 0 && a.c < q.choices.length; if (answered) dist[a.c]++;
    const ok = answered && a.c === q.correct; const ms = answered ? Math.max(0, Math.min(limit, Number(a.ms) || limit)) : limit;
    const base = ok ? Math.round(500 + 500 * (1 - ms / limit)) : 0; const streak = ok ? (pr.streak || 0) + 1 : 0; const bonus = ok && streak >= 2 ? Math.min(300, (streak - 1) * 100) : 0;
    const perQ = (pr.perQ || []).slice(0, i); while (perQ.length < i) perQ.push(null); perQ[i] = { c: answered ? a.c : null, ok, pts: base + bonus };
    results[pid] = { name: String(p.name || 'Player').slice(0, 16), avatar: String(p.avatar || '🙂').slice(0, 8), score: (pr.score || 0) + base + bonus, last: base + bonus, correct: ok, answered, streak, perQ };
  }
  chime();
  await gameWrite({ status: 'reveal', correct: q.correct, dist, results });
  Priv.saveGame(H.code, { results }).catch(() => {});
}
function animateBoard(g) {
  const el = document.getElementById('board'); if (!el) return; const all = rankList(g.results);
  if (!all.length) { el.innerHTML = `<p class="muted" style="text-align:center">No players yet.</p>`; return; }
  const prevOrder = [...all].sort((a, b) => ((b.score - b.last) - (a.score - a.last)) || String(a.name).localeCompare(String(b.name))).map(r => r.id);
  const shown = all.slice(0, 8), ROW = 72, max = Math.max(1, all[0].score); el.style.height = (shown.length * ROW) + 'px';
  el.innerHTML = shown.map((r, idx) => { const pi = prevOrder.indexOf(r.id); const startTop = Math.min(pi, shown.length) * ROW; const moved = pi - idx;
    return `<div class="lb-row" style="top:${startTop}px;${pi >= shown.length ? 'opacity:0' : ''}">
      <span class="lb-rank">${idx + 1}</span><span class="lb-av">${esc(r.avatar)}</span><span class="lb-name">${esc(r.name)}</span>
      <div class="lb-track"><div class="lb-bar" style="--cc:${COLORS[idx % 4]};width:${100 * (r.score - r.last) / max}%" data-w="${100 * r.score / max}"></div></div>
      <span class="lb-score"><span data-from="${r.score - r.last}" data-to="${r.score}">${r.score - r.last}</span>${r.last ? `<span class="delta">+${r.last}</span>` : ''}${moved > 0 ? `<span class="move">▲${moved}</span>` : ''}</span></div>`; }).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll('.lb-row').forEach((row, idx) => { row.style.top = (idx * ROW) + 'px'; row.style.opacity = '1'; const b = row.querySelector('.lb-bar'); b.style.width = b.dataset.w + '%'; });
    const nums = [...el.querySelectorAll('[data-to]')]; const t0 = performance.now();
    (function tw(t) { const k = Math.min(1, (t - t0) / 1100), e = 1 - Math.pow(1 - k, 3); nums.forEach(nm => { const f = +nm.dataset.from, to = +nm.dataset.to; nm.textContent = Math.round(f + (to - f) * e); }); if (k < 1) requestAnimationFrame(tw); })(t0);
  }));
}
async function endGame() {
  const g = H.game; await gameWrite({ status: 'ended', endedAt: Date.now() });
  try { await Priv.saveGame(H.code, { status: 'ended', endedAt: Date.now(), results: clone(g.results || {}), title: H.title, questions: H.questions }); } catch (e) { toast(hErr(e)); }
  ls.del('bb:host');
}

/* ---------- actions ---------- */
async function goLibrary() { S.view = 'library'; S.confirm = null; S.quizzes = null; render();
  try { S.quizzes = await Priv.listQuizzes(); } catch (e) { S.quizzes = []; toast(hErr(e)); } if (S.view === 'library') render(); }
async function goHistory() { S.view = 'history'; S.confirm = null; S.games = null; render();
  try { S.games = await Priv.listGames(); } catch (e) { S.games = []; toast(hErr(e)); } if (S.view === 'history') render(); }
const A = {
  async login() {
    const email = S.email.trim(); if (!email || !S.password) { S.loginErr = 'Enter your email and password.'; return render(); }
    S.busy = true; S.loginErr = ''; render();
    try { await signInWithEmailAndPassword(auth, email, S.password); S.password = ''; }
    catch (e) { const c = String(e.code || ''); S.loginErr = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? 'That email and password don’t match a teacher account.'
      : c.includes('too-many-requests') ? 'Too many tries. Wait a few minutes, or reset your password.' : hErr(e); }
    S.busy = false; render();
  },
  async reset() { const email = S.email.trim(); if (!email) { S.loginErr = 'Type your email above first.'; return render(); }
    try { await sendPasswordResetEmail(auth, email); toast('If that account exists, a reset email is on its way.'); } catch (e) { toast(hErr(e)); } },
  async logout() { stopHosting(); await signOut(auth); },
  goLibrary, goHistory,
  goImport() { S.view = 'import'; S.importResult = null; render(); },
  async delQuiz(el) { const id = el.dataset.id; if (S.confirm !== 'q:' + id) { S.confirm = 'q:' + id; render(); return; }
    S.confirm = null; try { await Priv.deleteQuiz(id); S.quizzes = S.quizzes.filter(q => q.id !== id); } catch (e) { toast(hErr(e)); } render(); },
  exportQuiz(el) { const q = S.quizzes.find(x => x.id === el.dataset.id); S.modal = { title: q.title, note: 'Copy this XML to back up the quiz or share it with another teacher.', text: toXML(q) }; render(); },
  closeModal(el, ev) { if (ev && ev.target.closest('[data-stop]') && !ev.target.closest('[data-act="closeModal"]')) return; S.modal = null; render(); },
  async copyModal() { const ta = document.getElementById('modalText'); try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { ta.select(); toast('Selected. Press Ctrl+C or ⌘C to copy.'); } },
  useTemplate() { S.importText = TEMPLATE; S.importResult = null; render(); },
  checkXML() { S.importResult = parseXML(S.importText || ''); render(); },
  async saveImport() { const r = S.importResult;
    try { for (const q of r.quizzes) await Priv.saveQuiz(q); toast(r.quizzes.length > 1 ? `${r.quizzes.length} quizzes saved` : 'Quiz saved'); S.importText = ''; S.importResult = null; goLibrary(); }
    catch (e) { toast(hErr(e)); } },
  async host(el) { const q = S.quizzes.find(x => x.id === el.dataset.id); if (!q) return; el.disabled = true; el.textContent = 'Starting…';
    try { await hostQuiz(q); } catch (e) { toast(e && e.message === 'code' ? 'Couldn’t find a free game code. Try again.' : hErr(e)); el.disabled = false; el.textContent = 'Host live'; } },
  openGame(el) { S.detail = S.games.find(x => x.id === el.dataset.id); S.view = 'detail'; render(); },
  async delGame(el) { const id = el.dataset.id; if (S.confirm !== 'g:' + id) { S.confirm = 'g:' + id; render(); return; } S.confirm = null;
    try {
      const live = await getDoc(gameRef(id));
      if (live.exists()) { const ps = await getDocs(collection(db, 'games', id, 'players')); for (const d of ps.docs) await deleteDoc(d.ref); await deleteDoc(gameRef(id)); }
      await Priv.deleteGame(id); S.games = S.games.filter(g => g.id !== id);
    } catch (e) { toast(hErr(e)); } render(); },
  csv() { if (S.view === 'detail') downloadCSV(S.detail.title, S.detail.questions, S.detail.results); else if (H && H.game) downloadCSV(H.title, H.questions, H.game.results); },
  toggleSound() { sound.on = !sound.on; if (H) H.lastKey = null; renderHost(); },
  hStart() { beep(660, .1); startQuestion(0); },
  hReveal() { reveal(); },
  hBoard() { gameWrite({ status: 'board' }); },
  hNext() { const i = H.game.qIndex; if (i + 1 < H.questions.length) startQuestion(i + 1); else endGame(); },
  async endGame() {
    if (S.confirm !== 'end') { S.confirm = 'end'; H.lastKey = null; renderHost(); setTimeout(() => { if (S.confirm === 'end' && H) { S.confirm = null; H.lastKey = null; renderHost(); } }, 4000); return; }
    S.confirm = null; await endGame();
  },
  hExit() { stopHosting(); goLibrary(); }
};
document.addEventListener('click', ev => { const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return; const f = A[el.dataset.act]; if (f) { ev.preventDefault(); f(el, ev); } });
document.addEventListener('input', ev => { const t = ev.target; if (t.dataset.bind) S[t.dataset.bind] = t.value; });
document.addEventListener('change', ev => { const t = ev.target;
  if (t.dataset.actChange === 'xmlFile' && t.files && t.files[0]) { const f = t.files[0]; if (f.size > 2e6) { toast('That file is too big for a quiz.'); return; }
    f.text().then(txt => { S.importText = txt; S.importResult = parseXML(txt); render(); }); } });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.modal) { S.modal = null; render(); }
  if (ev.key === 'Enter' && S.view === 'login' && ev.target.dataset && ev.target.dataset.bind) A.login(); });

/* ---------- boot ---------- */
render();
if (configured) {
  onAuthStateChanged(auth, async u => {
    S.authReady = true;
    if (!u || u.isAnonymous) { stopHosting(); S.user = null; S.view = 'login'; render(); return; }
    if (S.user && S.user.uid === u.uid) return;
    S.user = u;
    const h = ls.get('bb:host', null);
    if (h && h.uid === u.uid) {
      try { const g = await getDoc(gameRef(h.code)); const rec = await Priv.getGame(h.code);
        if (g.exists() && g.data().status !== 'ended' && rec) { startHosting(h.code, rec.questions, rec.title); return; } } catch {}
      ls.del('bb:host');
    }
    goLibrary();
  });
}
