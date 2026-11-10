'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { charger } = require('./faux-apps-script');

const tb = charger(['Blackjack.gs', 'Table.gs']);
const alea = () => tb.bjCreerTirage(() => Array.from(crypto.randomBytes(32)));
const T0 = 1_000_000;

/** Table avec joueurs assis et ayant misé, puis mains imposées pour un test déterministe. */
function tableTruquee(joueurs, croupier, paquet) {
  const t = tb.tbNouvelle();
  joueurs.forEach((j) => { tb.tbAsseoir(t, j.cle, j.cle); tb.tbMiser(t, j.cle, j.mise || 100, T0); });
  tb.tbAvancer(t, T0, alea()); // distribution
  // On impose les mains (et on rejoue la distribution sur cet état).
  t.phase = 'jeu';
  t.croupier = croupier.slice();
  t.paquet = paquet.slice();
  joueurs.forEach((j, i) => {
    const p = t.places[i];
    p.main = j.main.slice();
    p.statut = tb.bjEstBlackjack(p.main) ? 'blackjack' : 'joue';
    p.resultat = null; p.gain = 0;
  });
  t.tour = null;
  return t;
}

test('asseoir : refuse le doublon et la table pleine', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'A');
  assert.throws(() => tb.tbAsseoir(t, 'a', 'A'), /deja_assis/);
  ['b', 'c', 'd', 'e'].forEach((c) => tb.tbAsseoir(t, c, c));
  assert.throws(() => tb.tbAsseoir(t, 'f', 'f'), /table_pleine/);
});

test('distribution immédiate quand tous les joueurs assis ont misé', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbAsseoir(t, 'b', 'b');
  tb.tbMiser(t, 'a', 50, T0);
  tb.tbAvancer(t, T0, alea());
  assert.equal(t.phase, 'mises', 'b n\'a pas misé');
  tb.tbMiser(t, 'b', 50, T0 + 1000);
  tb.tbAvancer(t, T0 + 1000, alea());
  assert.notEqual(t.phase, 'mises');
  t.places.forEach((p) => assert.equal(p.main.length, 2));
  assert.equal(t.croupier.length, 2);
  // 52 - 2*2 joueurs - 2 croupier (ou moins si la manche est déjà réglée)
  assert.ok(t.phase === 'fin' || t.paquet.length === 46);
});

test('distribution à l\'échéance si certains ne misent pas', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbAsseoir(t, 'b', 'b');
  tb.tbMiser(t, 'a', 50, T0);
  assert.equal(tb.tbTransitionDue(t, T0 + tb.TB.DUREE_MISES_MS - 1), false);
  assert.equal(tb.tbTransitionDue(t, T0 + tb.TB.DUREE_MISES_MS), true);
  tb.tbAvancer(t, T0 + tb.TB.DUREE_MISES_MS, alea());
  assert.notEqual(t.phase, 'mises');
  assert.equal(t.places[1].main.length, 0, 'b ne joue pas cette manche');
});

test('miser : refusé hors phase de mises, ou deux fois', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbAsseoir(t, 'b', 'b');
  tb.tbMiser(t, 'a', 50, T0);
  assert.throws(() => tb.tbMiser(t, 'a', 50, T0), /deja_mise/);
  assert.throws(() => tb.tbMiser(t, 'z', 50, T0), /pas_assis/);
  t.phase = 'jeu';
  assert.throws(() => tb.tbMiser(t, 'b', 50, T0), /mises_fermees/);
});

test('tour par tour : seul le joueur actif peut agir', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '6H'] }, { cle: 'b', main: ['9S', '7H'] }],
    ['10D', '7C'], ['2C', '3C', '4C', '5C']
  );
  tb.tbAvancer(t, T0, alea());
  assert.equal(t.tour, 'a');
  assert.throws(() => tb.tbTirer(t, 'b', T0), /pas_ton_tour/);
  tb.tbRester(t, 'a', T0);
  assert.equal(t.tour, 'b');
  assert.throws(() => tb.tbRester(t, 'a', T0), /pas_ton_tour/);
});

test('sauter (>21) passe au suivant ; 21 reste automatiquement', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '6H'] }, { cle: 'b', main: ['9S', '7H'] }],
    ['10D', '7C'], ['5C', 'KC'] // pop() : a tire KC (26), b tire 5C (21)
  );
  tb.tbAvancer(t, T0, alea());
  tb.tbTirer(t, 'a', T0);
  assert.equal(t.places[0].statut, 'saute');
  assert.equal(t.tour, 'b');
  tb.tbTirer(t, 'b', T0);
  // b a 21 -> reste auto -> croupier (17) reste -> règlement
  assert.equal(t.phase, 'fin');
  assert.equal(t.places[0].resultat, 'perdu');
  assert.equal(t.places[1].resultat, 'gagne');
});

test('temps écoulé : le joueur reste automatiquement', () => {
  const t = tableTruquee([{ cle: 'a', main: ['10S', '9H'] }], ['10D', '7C'], ['2C']);
  tb.tbAvancer(t, T0, alea());
  assert.equal(t.tour, 'a');
  tb.tbAvancer(t, T0 + tb.TB.DUREE_TOUR_MS, alea());
  assert.equal(t.phase, 'fin');
  assert.equal(t.places[0].resultat, 'gagne'); // 19 contre 17
});

test('le croupier tire jusqu\'à 17 et les gains sont versés', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '9H'], mise: 100 }, { cle: 'b', main: ['AS', 'KH'], mise: 20 }],
    ['10D', '2C'], ['9C', '5C'] // croupier : 12 + 5 = 17
  );
  tb.tbAvancer(t, T0, alea());
  const mouvements = tb.tbRester(t, 'a', T0);
  assert.deepEqual([...t.croupier], ['10D', '2C', '5C']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(mouvements)),
    [{ cle: 'a', montant: 200, motif: 'gain:gagne' }, { cle: 'b', montant: 50, motif: 'gain:blackjack' }]
  );
});

/** Remplace temporairement le mélange par un paquet imposé (distribué par pop()). */
function avecPaquet(paquet, fn) {
  const original = tb.bjMelanger;
  tb.bjMelanger = () => paquet.slice();
  try { return fn(); } finally { tb.bjMelanger = original; }
}

test('blackjack du croupier : manche réglée dès la distribution', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbMiser(t, 'a', 100, T0);
  // pop() : joueur 10S, croupier AD, joueur 9H, croupier KC
  const mouvements = avecPaquet(['2C', 'KC', '9H', 'AD', '10S'], () => tb.tbAvancer(t, T0, alea()));
  assert.equal(t.phase, 'fin');
  assert.equal(t.places[0].resultat, 'perdu');
  assert.equal(mouvements.length, 0);
});

test('blackjack du joueur : payé 3:2 sans jouer', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbMiser(t, 'a', 100, T0);
  // pop() : joueur AS, croupier 10D, joueur KH, croupier 7C
  const mouvements = avecPaquet(['2C', '7C', 'KH', '10D', 'AS'], () => tb.tbAvancer(t, T0, alea()));
  assert.equal(t.phase, 'fin');
  assert.deepEqual([...t.croupier], ['10D', '7C'],'le croupier ne tire pas : personne n\'est resté');
  assert.deepEqual(JSON.parse(JSON.stringify(mouvements)), [{ cle: 'a', montant: 250, motif: 'gain:blackjack' }]);
});

test('quitter pendant les mises : mise remboursée', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbAsseoir(t, 'b', 'b');
  tb.tbMiser(t, 'a', 80, T0);
  const m = tb.tbQuitter(t, 'a', T0);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), [{ cle: 'a', montant: 80, motif: 'remboursement' }]);
  tb.tbAvancer(t, T0, alea());
  assert.equal(t.phase, 'mises');
  assert.equal(t.echeance, null);
});

test('quitter pendant sa main : mise perdue, le tour passe', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '6H'] }, { cle: 'b', main: ['9S', '7H'] }],
    ['10D', '7C'], ['2C']
  );
  tb.tbAvancer(t, T0, alea());
  const m = tb.tbQuitter(t, 'a', T0);
  assert.equal(m.filter((x) => x.cle === 'a').length, 0);
  assert.equal(t.tour, 'b');
});

test('nouvelle manche et éviction des inactifs', () => {
  const t = tb.tbNouvelle();
  tb.tbAsseoir(t, 'a', 'a');
  tb.tbAsseoir(t, 'b', 'b');
  let now = T0;
  for (let manche = 0; manche < tb.TB.MANCHES_INACTIF_MAX; manche++) {
    tb.tbMiser(t, 'a', 10, now);
    now += tb.TB.DUREE_MISES_MS;
    tb.tbAvancer(t, now, alea());
    while (t.phase === 'jeu') { tb.tbRester(t, t.tour, now); }
    now += tb.TB.DUREE_FIN_MS;
    tb.tbAvancer(t, now, alea());
  }
  assert.equal(t.phase, 'mises');
  assert.deepEqual([...t.places.map((p) => p.cle)], ['a'], 'b, inactif, a été retiré');
});

test('vue publique : carte cachée et paquet jamais exposés', () => {
  const t = tableTruquee([{ cle: 'a', main: ['10S', '6H'] }], ['10D', '7C'], ['2C', '3C']);
  tb.tbAvancer(t, T0, alea());
  const vue = JSON.stringify(tb.tbVue(t, T0, 'a'));
  assert.ok(!vue.includes('7C'), 'carte cachée exposée');
  assert.ok(!vue.includes('paquet') && !vue.includes('2C') && !vue.includes('3C'), 'paquet exposé');
  assert.ok(!vue.includes('"cle"'), 'clé interne exposée');
  const v = tb.tbVue(t, T0, 'a');
  assert.equal(v.croupier.carteCachee, true);
  assert.equal(v.monTour, true);
  tb.tbRester(t, 'a', T0);
  assert.ok(JSON.stringify(tb.tbVue(t, T0, 'a')).includes('7C'), 'révélée en fin de manche');
});

test('quitter après « Rester » : la main est réglée, la place part à la manche suivante', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '9H'] }, { cle: 'b', main: ['9S', '7H'] }],
    ['10D', '7C'], ['2C']
  );
  tb.tbAvancer(t, T0, alea());
  tb.tbRester(t, 'a', T0);
  assert.deepEqual(JSON.parse(JSON.stringify(tb.tbQuitter(t, 'a', T0))), []);
  assert.equal(t.places.length, 2, 'la place reste jusqu\'au règlement');
  assert.equal(t.tour, 'b');
  const m = JSON.parse(JSON.stringify(tb.tbRester(t, 'b', T0)));
  assert.deepEqual(m.filter((x) => x.cle === 'a'), [{ cle: 'a', montant: 200, motif: 'gain:gagne' }]);
  tb.tbAvancer(t, T0 + tb.TB.DUREE_FIN_MS, alea());
  assert.equal(t.places.map((p) => p.cle).join(','), 'b');
  assert.ok(!('part' in tb.tbVue(t, T0, 'b').places[0]), 'champ interne non exposé');
});

test('quitter après « Rester » avec force (suppression du compte) : place retirée tout de suite', () => {
  const t = tableTruquee(
    [{ cle: 'a', main: ['10S', '9H'] }, { cle: 'b', main: ['9S', '7H'] }],
    ['10D', '7C'], ['2C']
  );
  tb.tbAvancer(t, T0, alea());
  tb.tbRester(t, 'a', T0);
  tb.tbQuitter(t, 'a', T0, true);
  assert.equal(t.places.map((p) => p.cle).join(','), 'b');
});
