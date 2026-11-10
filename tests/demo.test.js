'use strict';
/**
 * La démo est servie sur la même origine que le vrai jeu : elle ne doit JAMAIS
 * toucher au cookie de session réel (__Host-bj_session). Sans mot de passe,
 * perdre ce cookie = perdre son compte.
 *
 * Le test charge demo.js puis app.js (comme demo.html) dans un DOM simulé où
 * un vrai cookie de session existe déjà, et enregistre toutes les écritures de cookie.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FRONT = path.join(__dirname, '..', 'frontend');
const VRAI = '__Host-bj_session';
const JETON_REEL = 'a'.repeat(64);

/** Élément factice : accepte tout, ne contient rien. */
function creerElement() {
  const el = {
    style: {}, dataset: {}, hidden: false, disabled: false, value: '', checked: false,
    textContent: '', className: '', firstChild: null, children: [], childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild: (c) => c, removeChild: (c) => c, insertBefore: (c) => c, replaceChildren() {}, remove() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
  };
  return el;
}

function executerPage(scripts, cookiesInitiaux) {
  const pot = new Map(cookiesInitiaux);
  const ecritures = [];
  let actif = true;
  const minuteurs = new Set();
  const doc = {
    hidden: false, visibilityState: 'visible', readyState: 'complete',
    body: creerElement(), documentElement: creerElement(), head: creerElement(),
    getElementById: () => creerElement(), querySelector: () => creerElement(), querySelectorAll: () => [],
    createElement: () => creerElement(), createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: () => creerElement(), addEventListener() {}, removeEventListener() {},
    get cookie() { return [...pot].map(([k, v]) => k + '=' + v).join('; '); },
    set cookie(ligne) {
      ecritures.push(ligne);
      const [paire, ...attributs] = ligne.split(';').map((s) => s.trim());
      const i = paire.indexOf('=');
      const nom = paire.slice(0, i);
      if (attributs.some((a) => /^max-age=0$/i.test(a))) pot.delete(nom);
      else pot.set(nom, paire.slice(i + 1));
    }
  };
  const stockage = new Map();
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: doc,
    navigator: { userAgent: 'test', clipboard: { writeText: () => Promise.resolve() } },
    location: { href: 'https://payzzttv.github.io/BlackjackB3/demo.html', hash: '', reload() {}, assign() {} },
    localStorage: {
      getItem: (k) => (stockage.has(k) ? stockage.get(k) : null),
      setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k)
    },
    setTimeout: (fn, ms) => {
      if (!actif) return 0;
      const id = setTimeout(() => { minuteurs.delete(id); if (actif) fn(); }, Math.min(ms || 0, 5));
      minuteurs.add(id);
      return id;
    },
    clearTimeout: (id) => { clearTimeout(id); minuteurs.delete(id); },
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    confirm: () => true, alert() {},
    addEventListener() {}, removeEventListener() {},
    AbortController, Promise, JSON, Math, Date, Object, Array, Number, String, TypeError, Error, Map, Set
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.top = ctx;
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(FRONT, s), 'utf8'), ctx, { filename: s });
  return {
    pot, ecritures,
    attendre: (ms) => new Promise((r) => setTimeout(r, ms)),
    arreter: () => { actif = false; minuteurs.forEach(clearTimeout); }
  };
}

test('ouvrir la démo ne touche jamais au vrai cookie de session', async () => {
  const page = executerPage(['demo.js', 'app.js'], [[VRAI, JETON_REEL]]);
  await page.attendre(300); // démarrage, sondages, réponses du faux serveur
  page.arreter();
  const surLeVrai = page.ecritures.filter((l) => l.startsWith(VRAI + '='));
  assert.deepEqual(surLeVrai, [], 'la démo a écrit ou effacé le vrai cookie');
  assert.equal(page.pot.get(VRAI), JETON_REEL);
});

test('demo.js : cookie dédié, accepté par app.js', () => {
  const demo = fs.readFileSync(path.join(FRONT, 'demo.js'), 'utf8');
  assert.ok(!demo.includes(VRAI), 'demo.js ne doit pas mentionner le cookie réel');
  const nom = (demo.match(/NOM_COOKIE_DEMO = '([^']+)'/) || [])[1];
  assert.ok(nom && nom !== VRAI, 'cookie de démo distinct');
  assert.match(nom, /^__Host-bj_[a-z]{3,20}$/, 'même liste blanche que app.js');
});

test('app.js : un nom de cookie hors liste blanche est ignoré', () => {
  const app = fs.readFileSync(path.join(FRONT, 'app.js'), 'utf8');
  const ligne = app.split('\n').find((l) => /var NOM_COOKIE =/.test(l));
  const choisir = (config) => vm.runInNewContext(`var CONFIG = ${JSON.stringify(config)}; ${ligne} NOM_COOKIE`);
  assert.equal(choisir({}), VRAI);
  assert.equal(choisir({ NOM_COOKIE: '__Host-bj_demo' }), '__Host-bj_demo');
  for (const mauvais of ['autre', '__Host-bj_session; Domain=evil.test', 'bj_demo', '__Host-bj_DEMO', 42]) {
    assert.equal(choisir({ NOM_COOKIE: mauvais }), VRAI, String(mauvais));
  }
});

test('Pages ne publie pas la démo', () => {
  const pages = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  const etape = pages.indexOf('rm -f frontend/demo.html frontend/demo.js frontend/demo.css');
  assert.ok(etape > 0, 'étape d\'exclusion absente');
  assert.ok(etape < pages.indexOf('upload-pages-artifact'), 'l\'exclusion doit précéder l\'envoi');
});
