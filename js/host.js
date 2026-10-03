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
  const v = { login: viewLogin, library: viewLibrary, import: viewImport, history: viewHistory, detail: viewDetail, editor: viewEditor, setup: viewSetup }[S.view] || viewLogin;
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
    <h2>Add your first quiz</h2><p>Type the questions in yourself, or import XML (from Buzzboard on Claude, tap View XML on a quiz and paste it here).</p>
    <div class="row" style="justify-content:center"><button class="btn primary" data-act="goImport">Import XML</button><button class="btn" data-act="newQuiz">Write a quiz</button></div></div>`
    : `<div class="quiz-list">${qs.map(q => `<div class="card quiz-item"><div style="flex:1;min-width:12rem"><h3>${esc(q.title)}</h3>
      <p class="muted" style="margin:0">${q.questions.length} question${q.questions.length === 1 ? '' : 's'}</p></div>
      <div class="row"><button class="btn primary" data-act="host" data-id="${q.id}">Host live</button>
      <button class="btn small" data-act="editQuiz" data-id="${q.id}">Edit</button>
      <button class="btn small" data-act="exportQuiz" data-id="${q.id}">View XML</button>
      <button class="btn small danger" data-act="delQuiz" data-id="${q.id}">${S.confirm === 'q:' + q.id ? 'Tap again to delete' : 'Delete'}</button></div></div>`).join('')}</div>`;
  return `<main class="wrap"><div class="topbar"><h1>My quizzes</h1><span class="spacer"></span>
    <button class="btn small" data-act="goHistory">Past games</button><button class="btn small" data-act="goImport">Import XML</button><button class="btn small primary" data-act="newQuiz">New quiz</button>
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
    ${r.quizzes.length ? `<div class="row" style="margin-top:1rem"><button class="btn primary" data-act="saveImport">Save ${r.quizzes.length > 1 ? r.quizzes.length + ' quizzes' : 'quiz'}${r.errors.length ? ' (skip broken questions)' : ''}</button>
      ${r.quizzes.length === 1 ? `<button class="btn" data-act="editImport">Review and edit first</button>` : `<span class="muted">After saving, use Edit on each quiz to make changes.</span>`}</div>` : ''}
  </div>` : ''}
  <details class="card" style="margin-top:1.25rem"><summary>XML format guide</summary>
    <p style="margin-top:.8rem">Wrap everything in <code>&lt;quiz title="…"&gt;</code>. Each <code>&lt;question&gt;</code> has a <code>&lt;text&gt;</code> and 2 to 4 <code>&lt;choice&gt;</code> elements; add <code>correct="true"</code> to the right one. The optional <code>time</code> attribute sets seconds (5 to 120, default 20).</p>
    <p>Also accepted: <code>&lt;option&gt;</code> or <code>&lt;answer&gt;</code> instead of <code>&lt;choice&gt;</code>, an <code>answer="B"</code> attribute on the question, and several <code>&lt;quiz&gt;</code> elements inside one <code>&lt;quizzes&gt;</code> root.</p>
    <pre class="mono" style="overflow-x:auto;background:var(--field);border:3px solid var(--line);border-radius:12px;padding:.8rem">${esc(TEMPLATE)}</pre>
  </details></main>`;
}

/* ---------- quiz editor ---------- */
const blankQ = () => ({ text: '', choices: ['', '', '', ''], correct: 0, time: 20 });
const padChoices = q => { const ch = [...q.choices]; while (ch.length < 4) ch.push(''); return { ...q, choices: ch }; };
function openEditor(quiz, fromImport = false) {
  const e = clone(quiz); e.questions = (e.questions && e.questions.length ? e.questions : [blankQ()]).map(padChoices);
  S.edit = e; S.editFromImport = fromImport; S.editErr = ''; S.view = 'editor'; render(); window.scrollTo(0, 0);
}
function viewEditor() {
  const e = S.edit, n = e.questions.length;
  return `<main class="wrap"><div class="topbar"><button class="btn small" data-act="cancelEdit">Cancel</button><h1>${e.id ? 'Edit quiz' : S.editFromImport ? 'Review imported quiz' : 'New quiz'}</h1><span class="spacer"></span>
    <button class="btn primary" data-act="saveQuiz">Save quiz</button></div>
    <div class="card qcard"><label style="margin:0"><span>Quiz title</span><input data-ed="title" maxlength="80" placeholder="e.g. Java data types review" value="${esc(e.title)}"></label>
      <p class="muted" style="margin:.6rem 0 0">${n} question${n === 1 ? '' : 's'}. Fill in 2 to 4 choices per question and tick the right one.</p></div>
    ${e.questions.map((q, i) => `<div class="card qcard" id="q${i}"><div class="qhead"><span class="qnum-badge">${i + 1}</span><h3>Question</h3><span class="spacer"></span>
      <button class="btn small" data-act="moveQ" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move question ${i + 1} up">↑</button>
      <button class="btn small" data-act="moveQ" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move question ${i + 1} down">↓</button>
      <button class="btn small" data-act="dupQ" data-i="${i}">Duplicate</button>
      <button class="btn small danger" data-act="rmQ" data-i="${i}" ${n < 2 ? 'disabled' : ''}>Remove</button></div>
      <label><span>Question text</span><textarea data-ed="text" data-i="${i}" rows="2" maxlength="300" placeholder="Type the question">${esc(q.text)}</textarea></label>
      ${q.choices.map((c, j) => `<div class="choice-edit"><span class="lt" style="background:${COLORS[j]}">${LETTERS[j]}</span>
        <input data-ed="choice" data-i="${i}" data-j="${j}" maxlength="120" placeholder="${j < 2 ? 'Answer choice' : 'Optional choice'}" value="${esc(c)}" aria-label="Question ${i + 1}, choice ${LETTERS[j]}">
        <label class="cor"><input type="radio" name="cor${i}" data-ed="correct" data-i="${i}" data-j="${j}" ${q.correct === j ? 'checked' : ''}>Right</label></div>`).join('')}
      <label class="time-row"><span>Time limit (seconds)</span><input type="number" class="time-in" min="5" max="120" step="1" data-ed="time" data-i="${i}" value="${q.time}"></label>
    </div>`).join('')}
    ${S.editErr ? `<p class="err" role="alert">${esc(S.editErr)}</p>` : ''}
    <div class="row"><button class="btn" data-act="addQ">Add a question</button><span class="spacer"></span><button class="btn primary" data-act="saveQuiz">Save quiz</button></div></main>`;
}
function validateEditor() {
  const e = S.edit, title = (e.title || '').trim(); if (!title) return { err: 'Give the quiz a title.' };
  const qs = [];
  for (let i = 0; i < e.questions.length; i++) {
    const q = e.questions[i], text = (q.text || '').trim(), at = i;
    if (!text) return { err: `Question ${i + 1} needs some text.`, at };
    if (!(q.choices[q.correct] || '').trim()) return { err: `Question ${i + 1}: the choice marked Right is empty.`, at };
    const keep = q.choices.map((c, j) => ({ c: (c || '').trim(), j })).filter(x => x.c);
    if (keep.length < 2) return { err: `Question ${i + 1} needs at least two choices.`, at };
    let t = parseInt(q.time, 10); if (!Number.isFinite(t)) t = 20; t = Math.max(5, Math.min(120, t));
    qs.push({ text: text.slice(0, 300), choices: keep.map(x => x.c.slice(0, 120)), correct: keep.findIndex(x => x.j === q.correct), time: t });
  }
  return { quiz: { id: e.id || null, title: title.slice(0, 80), questions: qs } };
}

/* ---------- pre-game options ---------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function prepareQuiz(quiz, opts) {
  let questions = clone(quiz.questions);
  if (opts.shuffleQ) questions = shuffle(questions);
  if (opts.shuffleA) questions = questions.map(q => { const order = shuffle(q.choices.map((_, i) => i));
    return { ...q, choices: order.map(i => q.choices[i]), correct: order.indexOf(q.correct) }; });
  return { title: quiz.title, questions };
}
function viewSetup() {
  const st = S.setup, q = S.quizzes.find(x => x.id === st.id);
  return `<main class="wrap"><div class="topbar"><button class="btn small" data-act="goLibrary">Back</button><h1>Ready to host</h1></div>
    <div class="card setup-card"><h2 style="margin-bottom:.2rem">${esc(q.title)}</h2>
      <p class="muted">${q.questions.length} question${q.questions.length === 1 ? '' : 's'}, about ${Math.ceil(q.questions.reduce((s, x) => s + x.time + 12, 0) / 60)} minutes</p>
      <label class="opt"><input type="checkbox" data-opt="shuffleQ" ${st.shuffleQ ? 'checked' : ''}><span><b>Shuffle the question order</b><br><span class="muted">Questions come up in a random order this game.</span></span></label>
      <label class="opt"><input type="checkbox" data-opt="shuffleA" ${st.shuffleA ? 'checked' : ''}><span><b>Shuffle the answer choices</b><br><span class="muted">Choices are mixed up within each question. Avoid this if a quiz uses choices like “All of the above.”</span></span></label>
      <p class="muted" style="margin:.4rem 0 1rem">Your saved quiz isn't changed. Scores for this game are saved in the order it was played.</p>
      <button class="btn primary big" data-act="startHost" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Starting…' : 'Open the lobby'}</button>
    </div></main>`;
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
// Student numbers for the Item Analyzer file: alphabetical by name, 00001, 00002, ...
function studentNos(results) {
  const ids = Object.entries(results || {}).sort(([a, x], [b, y]) => String(x.name).localeCompare(String(y.name), undefined, { sensitivity: 'base' }) || a.localeCompare(b)).map(([id]) => id);
  return Object.fromEntries(ids.map((id, i) => [id, String(i + 1).padStart(5, '0')]));
}
function itemStats(questions, results) {
  const ranked = rankList(results);
  return questions.map((q, i) => { const counts = [0, 0, 0, 0], none = { n: 0 }; let ok = 0;
    for (const r of ranked) { const a = (r.perQ || [])[i]; if (a && a.c != null && a.c >= 0 && a.c < 4) { counts[a.c]++; if (a.ok) ok++; } else none.n++; }
    const tot = ranked.length; return { q, counts, none: none.n, ok, tot, pct: tot ? Math.round(100 * ok / tot) : 0 }; });
}
function resultsHTML(questions, results) {
  const ranked = rankList(results), n = questions.length, nos = studentNos(results);
  if (!ranked.length) return `<div class="card empty"><p>Nobody played this one.</p></div>`;
  const acc = itemStats(questions, results);
  return `<div class="section"><div class="row"><h2 style="margin:0">Scores</h2><span class="spacer"></span>
    <button class="btn small" data-act="pdf">Download PDF</button><button class="btn small" data-act="csv">Download CSV</button>
    <button class="btn small" data-act="iaf" title="Answer file for the Item Analyzer">Item Analyzer file</button></div>
    <div class="tbl-wrap" style="margin-top:.8rem"><table><thead><tr><th class="num">Rank</th><th class="num">No.</th><th>Player</th><th class="num">Score</th><th class="num">Correct</th></tr></thead><tbody>
    ${ranked.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="num muted">${nos[r.id]}</td><td>${esc(r.avatar)} ${esc(r.name)}</td><td class="num">${r.score}</td><td class="num">${(r.perQ || []).filter(a => a && a.ok).length} / ${n}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="margin-top:.5rem">No. is each student's number in the Item Analyzer file (alphabetical by nickname).</p></div>
    <div class="section"><h2>How each question went</h2><div class="card acc-list">
    ${acc.map((a, i) => `<div class="acc"><div><b>${i + 1}.</b> ${esc(a.q.text)} <span class="muted">(${LETTERS[a.q.correct]}: ${esc(a.q.choices[a.q.correct])})</span></div>
      <div class="bar" role="img" aria-label="${a.pct}% correct"><i style="width:${a.pct}%"></i></div><div style="text-align:right;font-weight:700">${a.tot ? a.pct + '%' : 'n/a'}</div></div>`).join('')}
    </div></div>`;
}
const safeName = t => (t || 'quiz').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'quiz';
function saveBlob(filename, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function downloadCSV({ title, questions, results }) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const nos = studentNos(results);
  const head = ['Rank', 'No.', 'Name', 'Score', 'Correct', ...questions.map((_, i) => `Q${i + 1} answer`), ...questions.map((_, i) => `Q${i + 1} points`)];
  const rows = rankList(results).map((r, i) => { const pq = r.perQ || []; return [i + 1, nos[r.id], r.name, r.score, pq.filter(a => a && a.ok).length,
    ...questions.map((_, k) => pq[k] && pq[k].c != null ? LETTERS[pq[k].c] : ''), ...questions.map((_, k) => pq[k] ? pq[k].pts : 0)]; });
  saveBlob(`${safeName(title)}-scores.csv`, new Blob(['\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }));
}
// Item Analyzer format: line 1 = 00000 + answer key, line 2 = 00000 + a 1 per item,
// then one line per student: 5-digit number + their letters (E = no answer). CRLF line endings.
function buildIAF(questions, results) {
  const nos = studentNos(results), byNo = Object.entries(nos).sort((a, b) => a[1].localeCompare(b[1]));
  const lines = ['00000' + questions.map(q => LETTERS[q.correct]).join(''), '00000' + '1'.repeat(questions.length)];
  for (const [id, no] of byNo) { const pq = (results[id] && results[id].perQ) || [];
    lines.push(no + questions.map((_, k) => pq[k] && pq[k].c != null && pq[k].c >= 0 && pq[k].c < 4 ? LETTERS[pq[k].c] : 'E').join('')); }
  return lines.join('\r\n') + '\r\n';
}
function downloadIAF({ title, questions, results }) {
  if (!Object.keys(results || {}).length) { toast('Nobody played this game, so there are no answers to export.'); return; }
  saveBlob(`${safeName(title)} IAF.txt`, new Blob([buildIAF(questions, results)], { type: 'text/plain' }));
}

/* PDF: built with jsPDF + AutoTable, which paginate long tables and repeat headers on every page. */
const PDF_LIBS = ['https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'];
const loadScript = src => new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load')); document.head.appendChild(s); });
async function loadPDFLibs() { if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(PDF_LIBS[0]); if (!(window.jspdf.jsPDF.API.autoTable)) await loadScript(PDF_LIBS[1]); }
// Built-in PDF fonts only cover Western characters, so emoji and other symbols are dropped.
const pdfText = s => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '').replace(/\s+/g, ' ').trim();
async function downloadPDF({ title, questions, results, createdAt, code }, btn) {
  const ranked = rankList(results); if (!ranked.length) { toast('Nobody played this game, so there are no results to export.'); return; }
  const label = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Making PDF…'; }
  try { await loadPDFLibs(); } catch { toast('Couldn’t load the PDF tool. Check the internet connection and try again.'); if (btn) { btn.disabled = false; btn.textContent = label; } return; }
  try {
    const { jsPDF } = window.jspdf, d = new jsPDF({ unit: 'mm', format: 'a4' }), W = d.internal.pageSize.getWidth(), M = 14;
    const nos = studentNos(results), n = questions.length, stats = itemStats(questions, results);
    const correctOf = r => (r.perQ || []).filter(a => a && a.ok).length;
    const avgScore = Math.round(ranked.reduce((s, r) => s + r.score, 0) / ranked.length);
    const avgPct = n ? Math.round(100 * ranked.reduce((s, r) => s + correctOf(r), 0) / (ranked.length * n)) : 0;
    // Header: every line is placed below the previous one, so long titles wrap without overlapping.
    const lineH = pt => pt * 0.3528 * 1.25;   // font size in points -> line height in mm
    let y = 12;
    d.setFont('helvetica', 'bold'); d.setFontSize(18);
    const titleLines = d.splitTextToSize(pdfText(title) || 'Quiz results', W - 2 * M);
    y += lineH(18) * 0.8; d.text(titleLines, M, y, { lineHeightFactor: 1.25 }); y += lineH(18) * (titleLines.length - 1) + 3;
    d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(80);
    for (const line of [`${fmtDate(createdAt)}   |   Game code ${code}   |   ${ranked.length} students   |   ${n} questions`,
      `Class average: ${avgScore} points, ${avgPct}% correct   |   Highest: ${ranked[0].score} points`]) {
      const parts = d.splitTextToSize(line, W - 2 * M); y += lineH(10); d.text(parts, M, y, { lineHeightFactor: 1.25 }); y += lineH(10) * (parts.length - 1);
    }
    d.setTextColor(0);
    y += 9;
    const common = { margin: { left: M, right: M, top: 16, bottom: 16 }, showHead: 'everyPage', rowPageBreak: 'avoid', theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 1.8, lineColor: [200, 200, 200], lineWidth: .2, overflow: 'linebreak' },
      headStyles: { fillColor: [29, 41, 81], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [247, 247, 242] } };
    d.setFont('helvetica', 'bold'); d.setFontSize(13); d.text('Scores', M, y);
    d.autoTable({ ...common, startY: y + 3,
      head: [['Rank', 'No.', 'Student', 'Score', 'Correct', '%']],
      body: ranked.map((r, i) => { const c = correctOf(r); return [i + 1, nos[r.id], pdfText(r.name) || '(no name)', r.score, `${c} / ${n}`, n ? Math.round(100 * c / n) + '%' : '']; }),
      columnStyles: { 0: { halign: 'right', cellWidth: 14 }, 1: { cellWidth: 16 }, 3: { halign: 'right', cellWidth: 20 }, 4: { halign: 'right', cellWidth: 22 }, 5: { halign: 'right', cellWidth: 16 } } });
    y = d.lastAutoTable.finalY + 10; if (y > d.internal.pageSize.getHeight() - 40) { d.addPage(); y = 20; }
    d.setFont('helvetica', 'bold'); d.setFontSize(13); d.text('Item analysis', M, y);
    d.autoTable({ ...common, startY: y + 3,
      head: [['#', 'Question', 'Key', 'A', 'B', 'C', 'D', 'No ans.', '% correct']],
      body: stats.map((s, i) => [i + 1, pdfText(s.q.text), LETTERS[s.q.correct], ...[0, 1, 2, 3].map(k => k < s.q.choices.length ? s.counts[k] : '-'), s.none, s.pct + '%']),
      columnStyles: { 0: { halign: 'right', cellWidth: 9 }, 2: { halign: 'center', cellWidth: 11, fontStyle: 'bold' },
        3: { halign: 'center', cellWidth: 10 }, 4: { halign: 'center', cellWidth: 10 }, 5: { halign: 'center', cellWidth: 10 }, 6: { halign: 'center', cellWidth: 10 },
        7: { halign: 'center', cellWidth: 16 }, 8: { halign: 'right', cellWidth: 19 } },
      didParseCell: c => { if (c.section === 'body' && c.column.index >= 3 && c.column.index <= 6 && c.column.index - 3 === questions[c.row.index].correct) { c.cell.styles.fontStyle = 'bold'; c.cell.styles.textColor = [18, 131, 78]; } } });
    y = d.lastAutoTable.finalY + 6; if (y > d.internal.pageSize.getHeight() - 20) { d.addPage(); y = 20; }
    d.setFont('helvetica', 'normal'); d.setFontSize(8.5); d.setTextColor(90);
    d.text(d.splitTextToSize('Columns A to D show how many students picked each choice; the correct one is in green. No. matches the student numbers in the Item Analyzer file.', W - 2 * M), M, y);
    d.setFontSize(8.5);
    let footTitle = pdfText(title); const maxW = W - 2 * M - 30;
    if (d.getTextWidth(footTitle) > maxW) { while (footTitle && d.getTextWidth(footTitle + '...') > maxW) footTitle = footTitle.replace(/\s*\S+$/, ''); footTitle += '...'; }
    const pages = d.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { d.setPage(p); d.setFontSize(8.5); d.setTextColor(120);
      d.text(footTitle, M, d.internal.pageSize.getHeight() - 8); d.text(`Page ${p} of ${pages}`, W - M, d.internal.pageSize.getHeight() - 8, { align: 'right' }); }
    d.save(`${safeName(title)}-results.pdf`);
  } catch (e) { console.error(e); toast('Couldn’t make the PDF. Try again.'); }
  if (btn) { btn.disabled = false; btn.textContent = label; }
}

function exportCtx() {
  if (S.view === 'detail' && S.detail) return { title: S.detail.title, questions: S.detail.questions, results: S.detail.results || {}, createdAt: S.detail.createdAt, code: S.detail.id };
  if (H && H.game) return { title: H.title, questions: H.questions, results: H.game.results || {}, createdAt: H.game.createdAt, code: H.code };
  return null;
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
  host(el) { const q = S.quizzes.find(x => x.id === el.dataset.id); if (!q) return; const o = ls.get('bb:shuffle', {});
    S.setup = { id: q.id, shuffleQ: !!o.shuffleQ, shuffleA: !!o.shuffleA }; S.view = 'setup'; render(); },
  async startHost() { const q = S.quizzes.find(x => x.id === S.setup.id); if (!q || S.busy) return;
    ls.set('bb:shuffle', { shuffleQ: S.setup.shuffleQ, shuffleA: S.setup.shuffleA }); S.busy = true; render();
    try { await hostQuiz(prepareQuiz(q, S.setup)); } catch (e) { toast(e && e.message === 'code' ? 'Couldn’t find a free game code. Try again.' : hErr(e)); }
    S.busy = false; if (S.view === 'setup') render(); },
  newQuiz() { openEditor({ id: null, title: '', questions: [blankQ()] }); },
  editQuiz(el) { const q = S.quizzes.find(x => x.id === el.dataset.id); if (q) openEditor(q); },
  editImport() { const q = S.importResult && S.importResult.quizzes[0]; if (q) openEditor({ id: null, ...q }, true); },
  cancelEdit() { if (S.editFromImport) { S.view = 'import'; render(); } else goLibrary(); },
  addQ() { const last = S.edit.questions[S.edit.questions.length - 1]; const q = blankQ(); if (last) q.time = parseInt(last.time, 10) || 20;
    S.edit.questions.push(q); render(); const t = document.querySelectorAll('textarea[data-ed="text"]'); const el = t[t.length - 1]; if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } },
  rmQ(el) { S.edit.questions.splice(+el.dataset.i, 1); render(); },
  dupQ(el) { const i = +el.dataset.i; S.edit.questions.splice(i + 1, 0, clone(S.edit.questions[i])); render(); document.getElementById('q' + (i + 1))?.scrollIntoView({ block: 'center' }); },
  moveQ(el) { const i = +el.dataset.i, j = i + (+el.dataset.d), qs = S.edit.questions; if (j < 0 || j >= qs.length) return; [qs[i], qs[j]] = [qs[j], qs[i]]; render();
    const b = document.querySelector(`#q${j} [data-act="moveQ"][data-d="${el.dataset.d}"]`) || document.getElementById('q' + j); b && b.focus(); },
  async saveQuiz() { const r = validateEditor();
    if (r.err) { S.editErr = r.err; render(); document.getElementById('q' + r.at)?.scrollIntoView({ block: 'center' }); return; }
    if (S.busy) return; S.busy = true;
    try { await Priv.saveQuiz(r.quiz); toast('Quiz saved'); if (S.editFromImport) { S.importText = ''; S.importResult = null; } S.edit = null; S.busy = false; goLibrary(); }
    catch (e) { S.busy = false; S.editErr = hErr(e); render(); } },
  openGame(el) { S.detail = S.games.find(x => x.id === el.dataset.id); S.view = 'detail'; render(); },
  async delGame(el) { const id = el.dataset.id; if (S.confirm !== 'g:' + id) { S.confirm = 'g:' + id; render(); return; } S.confirm = null;
    try {
      const live = await getDoc(gameRef(id));
      if (live.exists()) { const ps = await getDocs(collection(db, 'games', id, 'players')); for (const d of ps.docs) await deleteDoc(d.ref); await deleteDoc(gameRef(id)); }
      await Priv.deleteGame(id); S.games = S.games.filter(g => g.id !== id);
    } catch (e) { toast(hErr(e)); } render(); },
  csv() { const c = exportCtx(); if (c) downloadCSV(c); },
  pdf(el) { const c = exportCtx(); if (c) downloadPDF(c, el); },
  iaf() { const c = exportCtx(); if (c) downloadIAF(c); },
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
document.addEventListener('input', ev => { const t = ev.target; if (t.dataset.bind) S[t.dataset.bind] = t.value;
  const ed = t.dataset.ed; if (ed && S.edit) { const i = +t.dataset.i, j = +t.dataset.j;
    if (ed === 'title') S.edit.title = t.value; else if (ed === 'text') S.edit.questions[i].text = t.value;
    else if (ed === 'choice') S.edit.questions[i].choices[j] = t.value; else if (ed === 'time') S.edit.questions[i].time = t.value; } });
document.addEventListener('change', ev => { const t = ev.target;
  if (t.dataset.ed === 'correct' && S.edit) S.edit.questions[+t.dataset.i].correct = +t.dataset.j;
  if (t.dataset.ed === 'time' && S.edit) { let v = parseInt(t.value, 10); if (!Number.isFinite(v)) v = 20; v = Math.max(5, Math.min(120, v)); t.value = v; S.edit.questions[+t.dataset.i].time = v; }
  if (t.dataset.opt && S.setup) S.setup[t.dataset.opt] = t.checked;
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
