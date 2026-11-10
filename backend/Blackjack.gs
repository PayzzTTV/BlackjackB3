/**
 * Règles pures du blackjack (aucun accès Google : testable avec Node).
 *
 * Carte = chaîne "<rang><couleur>" : "AS", "10H", "QD"...
 *   rangs    : A 2 3 4 5 6 7 8 9 10 J Q K
 *   couleurs : S (pique) H (cœur) D (carreau) C (trèfle)
 */

var BJ_RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
var BJ_COULEURS = ['S', 'H', 'D', 'C'];

/**
 * Fabrique un tirage d'entiers uniformes à partir d'une source d'octets aléatoires.
 * Tirage par rejet sur 16 bits : aucun biais modulo.
 * @param {function(): number[]} sourceOctets renvoie un tableau d'octets (signés ou non)
 * @return {function(number): number} randInt(n) -> entier uniforme dans [0, n)
 */
function bjCreerTirage(sourceOctets) {
  var reserve = [];
  function octet() {
    if (reserve.length === 0) {
      var lot = sourceOctets();
      for (var i = 0; i < lot.length; i++) reserve.push(lot[i] & 0xff);
    }
    return reserve.pop();
  }
  return function randInt(n) {
    if (!Number.isInteger(n) || n < 1 || n > 65536) throw new Error('Borne de tirage invalide');
    var limite = 65536 - (65536 % n);
    var x;
    do {
      x = (octet() << 8) | octet();
    } while (x >= limite);
    return x % n;
  };
}

function bjNouveauPaquet() {
  var paquet = [];
  for (var c = 0; c < BJ_COULEURS.length; c++) {
    for (var r = 0; r < BJ_RANGS.length; r++) paquet.push(BJ_RANGS[r] + BJ_COULEURS[c]);
  }
  return paquet;
}

/** Mélange de Fisher-Yates, en place. */
function bjMelanger(paquet, randInt) {
  for (var i = paquet.length - 1; i > 0; i--) {
    var j = randInt(i + 1);
    var tmp = paquet[i];
    paquet[i] = paquet[j];
    paquet[j] = tmp;
  }
  return paquet;
}

function bjValeurCarte(carte) {
  var rang = carte.slice(0, -1);
  if (rang === 'A') return 11;
  if (rang === 'J' || rang === 'Q' || rang === 'K') return 10;
  return parseInt(rang, 10);
}

/** Total d'une main, les As valant 11 ou 1 au mieux. */
function bjTotal(main) {
  var total = 0;
  var asA11 = 0;
  for (var i = 0; i < main.length; i++) {
    var v = bjValeurCarte(main[i]);
    total += v;
    if (v === 11) asA11++;
  }
  while (total > 21 && asA11 > 0) {
    total -= 10;
    asA11--;
  }
  return total;
}

function bjEstBlackjack(main) {
  return main.length === 2 && bjTotal(main) === 21;
}

/** Résultat d'une main joueur face à la main finale du croupier. */
function bjResultat(mainJoueur, mainCroupier) {
  var j = bjTotal(mainJoueur);
  var c = bjTotal(mainCroupier);
  var bjJ = bjEstBlackjack(mainJoueur);
  var bjC = bjEstBlackjack(mainCroupier);
  if (j > 21) return 'perdu';
  if (bjJ && bjC) return 'egalite';
  if (bjJ) return 'blackjack';
  if (bjC) return 'perdu';
  if (c > 21 || j > c) return 'gagne';
  if (j === c) return 'egalite';
  return 'perdu';
}

/** Montant à recréditer (mise comprise). */
function bjGain(resultat, mise) {
  switch (resultat) {
    case 'blackjack': return mise + Math.floor((mise * 3) / 2);
    case 'gagne': return mise * 2;
    case 'egalite': return mise;
    default: return 0;
  }
}
