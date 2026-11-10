'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { charger } = require('./faux-apps-script');

const bj = charger(['Blackjack.gs']);

test('paquet : 52 cartes uniques', () => {
  const p = bj.bjNouveauPaquet();
  assert.equal(p.length, 52);
  assert.equal(new Set(p).size, 52);
});

test('totaux : As à 11 ou 1', () => {
  assert.equal(bj.bjTotal(['AS', 'KH']), 21);
  assert.equal(bj.bjTotal(['AS', 'AH']), 12);
  assert.equal(bj.bjTotal(['AS', 'AH', '9D']), 21);
  assert.equal(bj.bjTotal(['AS', '5H', 'KD']), 16);
  assert.equal(bj.bjTotal(['10S', 'QH', '2D']), 22);
  assert.equal(bj.bjTotal([]), 0);
});

test('blackjack = 21 en 2 cartes seulement', () => {
  assert.equal(bj.bjEstBlackjack(['AS', 'JH']), true);
  assert.equal(bj.bjEstBlackjack(['7S', '7H', '7D']), false);
});

test('résultats', () => {
  assert.equal(bj.bjResultat(['10S', 'QH', '2D'], ['10H', '6C', 'KD']), 'perdu'); // joueur sauté d'abord
  assert.equal(bj.bjResultat(['AS', 'KH'], ['AH', 'QD']), 'egalite');
  assert.equal(bj.bjResultat(['AS', 'KH'], ['10H', 'QD']), 'blackjack');
  assert.equal(bj.bjResultat(['7S', '7H', '7D'], ['AH', 'QD']), 'perdu'); // 21 ne bat pas un blackjack
  assert.equal(bj.bjResultat(['10S', '8H'], ['10H', '6C', 'KD']), 'gagne'); // croupier sauté
  assert.equal(bj.bjResultat(['10S', '8H'], ['10H', '8C']), 'egalite');
  assert.equal(bj.bjResultat(['10S', '7H'], ['10H', '8C']), 'perdu');
});

test('gains (mise comprise)', () => {
  assert.equal(bj.bjGain('blackjack', 100), 250);
  assert.equal(bj.bjGain('blackjack', 15), 37); // 15 + 22 (arrondi inférieur)
  assert.equal(bj.bjGain('gagne', 100), 200);
  assert.equal(bj.bjGain('egalite', 100), 100);
  assert.equal(bj.bjGain('perdu', 100), 0);
});

test('tirage : bornes respectées et répartition uniforme', () => {
  const randInt = bj.bjCreerTirage(() => Array.from(crypto.randomBytes(32)));
  const n = 52;
  const tirages = 52000;
  const comptes = new Array(n).fill(0);
  for (let i = 0; i < tirages; i++) {
    const x = randInt(n);
    assert.ok(Number.isInteger(x) && x >= 0 && x < n);
    comptes[x]++;
  }
  // Khi² à 51 degrés de liberté : seuil très large (p << 0,001) pour éviter les faux positifs.
  const attendu = tirages / n;
  const khi2 = comptes.reduce((s, c) => s + (c - attendu) ** 2 / attendu, 0);
  assert.ok(khi2 < 110, 'khi2=' + khi2);
});

test('tirage : rejette les bornes invalides', () => {
  const randInt = bj.bjCreerTirage(() => [1, 2, 3, 4]);
  assert.throws(() => randInt(0));
  assert.throws(() => randInt(1.5));
  assert.throws(() => randInt(70000));
});

test('mélange : permutation du paquet', () => {
  const randInt = bj.bjCreerTirage(() => Array.from(crypto.randomBytes(32)));
  const m = bj.bjMelanger(bj.bjNouveauPaquet(), randInt);
  assert.equal(new Set(m).size, 52);
  assert.notDeepEqual(m, bj.bjNouveauPaquet());
});
