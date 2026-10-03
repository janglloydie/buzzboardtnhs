// Shared setup and helpers for the student page (play.js) and host page (host.js).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
export { onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
export { doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, onSnapshot, collection, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !!(firebaseConfig && firebaseConfig.apiKey && !/PASTE/.test(firebaseConfig.apiKey + firebaseConfig.projectId));
export const fbApp = configured ? initializeApp(firebaseConfig) : null;
export const auth = fbApp ? getAuth(fbApp) : null;
// iPhones, iPads, and in-app browsers (Messenger, Facebook, Instagram) often block the streaming
// connection Firestore uses for live updates, so updates only appear after a refresh. On those
// devices we switch to long polling, which works everywhere.
const ua = navigator.userAgent || '';
export const isApple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const inAppBrowser = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|MicroMessenger/i.test(ua);
export const needsLongPolling = isApple || inAppBrowser;
export const db = fbApp ? initializeFirestore(fbApp, needsLongPolling
  ? { experimentalForceLongPolling: true }
  : { experimentalAutoDetectLongPolling: true }) : null;

export const AVATARS = ['🦊','🐸','🐙','🦉','🐢','🐝','🦄','🐧','🐼','🦖','🐳','🦔','🐨','🦁','🐯','🐰','🐲','🦩','🐞','🦜'];
export const LETTERS = ['A','B','C','D'];
export const COLORS = ['var(--a)','var(--b)','var(--c)','var(--d)'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const rid = (n = 10) => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (const x of crypto.getRandomValues(new Uint8Array(n))) s += a[x % a.length]; return s; };
export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
export const clone = o => JSON.parse(JSON.stringify(o));
export const fmtCode = c => String(c).slice(0, 3) + ' ' + String(c).slice(3);
export const fmtDate = t => t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

let toastT = null;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 4500);
}
export function rankList(results) {
  return Object.entries(results || {}).map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => (b.score - a.score) || String(a.name).localeCompare(String(b.name)));
}
export function errMsg(e, who = 'student') {
  const c = String((e && e.code) || '');
  if (c.includes('permission-denied')) return who === 'host'
    ? "The database refused that. Check that this account's email is in the teacher list in firestore.rules, and that the rules are published."
    : "The database refused that. Ask your teacher to check the Firebase setup.";
  if (c.includes('resource-exhausted')) return "Today's free Firebase allowance is used up. It resets tomorrow.";
  if (c.includes('unavailable') || c.includes('network')) return "Can't reach the server. Check the internet connection and try again.";
  if (c.includes('admin-restricted-operation') || c.includes('operation-not-allowed')) return "Anonymous sign-in is turned off in Firebase. Ask your teacher to enable it (Setup guide, step 1.3).";
  return "Something went wrong" + (e && e.message ? ': ' + e.message : '.');
}

let AC = null;
export const sound = { on: true };
export function beep(f = 660, d = .14, type = 'triangle', vol = .08) {
  if (!sound.on) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + .02);
  } catch {}
}
export const chime = () => { beep(523, .18); setTimeout(() => beep(659, .18), 110); setTimeout(() => beep(784, .3), 220); };

export function confetti() {
  if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.id = 'confetti'; document.body.appendChild(c);
  const x = c.getContext('2d'); if (!x) return c.remove();
  const W = c.width = innerWidth, H = c.height = innerHeight;
  const cols = ['#E23A47','#1B78D6','#12834E','#7A3FCE','#FFD23F','#FFFDF4'];
  const ps = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
    s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  (function f(t) {
    x.clearRect(0, 0, W, H);
    for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); x.restore(); }
    if (t - t0 < 3200) requestAnimationFrame(f); else c.remove();
  })(t0);
}

export function notConfiguredHTML(where) {
  return `<div class="notice"><b>Firebase isn't connected yet.</b> ${where === 'host'
    ? 'Open <code>js/config.js</code>, paste your Firebase settings (Setup guide, step 2), and upload the file again.'
    : 'Your teacher still needs to finish setting up this page.'}</div>`;
}
