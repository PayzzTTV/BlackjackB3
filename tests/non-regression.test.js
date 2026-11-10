'use strict';
/**
 * Tests de non-régression : un test par anomalie corrigée, pour que la CI la garde.
 *
 * Course sondage / action (fix/b-course-sondage, PR #9) : un sondage « etat » parti
 * AVANT un clic sur « Tirer » pouvait revenir APRÈS la réponse de « Tirer » et effacer
 * la nouvelle carte. Correctif : demanderVue() numérote les requêtes et ignore
 * les réponses plus anciennes que la vue affichée.
 *
 * Le test extrait la vraie fonction demanderVue() de frontend/app.js et l'exécute
 * avec une fausse api() dont on choisit l'ordre des réponses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app.js'), 'utf8');

/**
 * Source d'une fonction de premier niveau de l'IIFE de app.js (indentée de 2 espaces).
 * Tolère les fins de ligne CRLF (clone Windows avec core.autocrlf).
 */
function sourceFonction(nom) {
  const debut = APP.indexOf('  function ' + nom + '(');
  assert.ok(debut >= 0, nom + '() introuvable dans app.js');
  const fin = /\r?\n {2}\}\r?\n/.exec(APP.slice(debut));
  assert.ok(fin, 'fin de ' + nom + '() introuvable');
  return APP.slice(debut, debut + fin.index + fin[0].length);
}

/**
 * demanderVue() branchée sur une fausse api() : chaque appel renvoie une promesse
 * que le test résout quand il veut, avec la vue de son choix.
 */
function monter() {
  const enAttente = [];
  const ctx = {
    etat: { numeroEmis: 0, numeroAffiche: 0 },
    api: (action) => new Promise((resoudre, rejeter) => enAttente.push({ action, resoudre, rejeter })),
    Promise
  };
  vm.createContext(ctx);
  vm.runInContext(sourceFonction('demanderVue'), ctx);
  return { demanderVue: ctx.demanderVue, enAttente, etat: ctx.etat };
}

test('course sondage / action : un sondage parti avant « Tirer » et revenu après est ignoré', async () => {
  const { demanderVue, enAttente } = monter();
  const sondage = demanderVue('etat');          // part en premier...
  const tirer = demanderVue('tirer');           // ...le clic part ensuite
  enAttente[1].resoudre({ cartes: 3 });         // « Tirer » revient en premier
  assert.deepEqual(await tirer, { cartes: 3 });
  enAttente[0].resoudre({ cartes: 2 });         // le vieux sondage revient après
  assert.equal(await sondage, null, 'la vue périmée (2 cartes) ne doit pas être affichée');
});

test('course sondage / action : dans l\'ordre normal, toutes les vues sont affichées', async () => {
  const { demanderVue, enAttente, etat } = monter();
  const a = demanderVue('etat');
  const b = demanderVue('tirer');
  enAttente[0].resoudre({ n: 1 });
  assert.deepEqual(await a, { n: 1 });
  enAttente[1].resoudre({ n: 2 });
  assert.deepEqual(await b, { n: 2 });
  assert.equal(etat.numeroAffiche, 2);
});

test('course sondage / action : une erreur ne fait pas avancer la vue affichée', async () => {
  const { demanderVue, enAttente, etat } = monter();
  const action = demanderVue('miser');
  const sondage = demanderVue('etat');
  enAttente[0].rejeter(Object.assign(new Error('Mise invalide.'), { code: 'mise_invalide' }));
  await assert.rejects(action, { code: 'mise_invalide' });
  assert.equal(etat.numeroAffiche, 0);
  enAttente[1].resoudre({ ok: true });
  assert.deepEqual(await sondage, { ok: true }, 'le sondage suivant doit encore s\'afficher');
});

test('course sondage / action : le sondage et les actions passent par demanderVue et ignorent null', () => {
  for (const nom of ['sonder']) {
    const src = sourceFonction(nom);
    assert.match(src, /demanderVue\('etat'\)/, nom + '() doit appeler demanderVue');
    assert.doesNotMatch(src, /\bapi\('etat'\)/, nom + '() ne doit plus appeler api() directement');
  }
  // Partout où une vue est affichée après demanderVue, la réponse null (périmée) est écartée.
  const appels = APP.match(/demanderVue\([^)]*\)[\s\S]{0,200}?afficherJeu\(data\)/g) || [];
  assert.ok(appels.length >= 2, 'sondage et actions doivent utiliser demanderVue');
  for (const bloc of appels) assert.match(bloc, /if \(data\) afficherJeu\(data\)/);
});
