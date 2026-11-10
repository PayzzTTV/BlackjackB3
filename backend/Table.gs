/**
 * Table de blackjack partagée (logique pure, testable avec Node).
 *
 * Cycle d'une manche :
 *   'mises' -> chaque joueur assis peut miser. La distribution part quand tous
 *              les joueurs assis ont misé, ou DUREE_MISES_MS après la 1re mise.
 *   'jeu'   -> les joueurs jouent chacun leur tour (DUREE_TOUR_MS max, sinon
 *              ils restent automatiquement). La 2e carte du croupier est cachée.
 *   'fin'   -> le croupier joue, les gains sont calculés, résultats affichés
 *              DUREE_FIN_MS, puis nouvelle manche.
 *
 * Les transitions temporelles sont « paresseuses » : elles sont appliquées par
 * tbAvancer() à la prochaine requête reçue (pas de minuteur côté serveur).
 *
 * Les fonctions qui modifient les soldes ne touchent pas au Sheet : elles
 * renvoient une liste de mouvements { cle, montant, motif } appliqués par Code.gs.
 */

var TB = {
  PLACES_MAX: 5,
  DUREE_MISES_MS: 8000,
  DUREE_TOUR_MS: 15000,
  DUREE_FIN_MS: 5000,
  MANCHES_INACTIF_MAX: 3
};

var TB_STATUTS_EN_MAIN = ['joue', 'reste', 'saute', 'blackjack'];

function tbNouvelle() {
  return { phase: 'mises', manche: 1, places: [], croupier: [], paquet: [], tour: null, echeance: null };
}

function tbErreur_(code) {
  var e = new Error(code);
  e.codeTable = code;
  return e;
}

function tbPlace_(table, cle) {
  for (var i = 0; i < table.places.length; i++) {
    if (table.places[i].cle === cle) return table.places[i];
  }
  return null;
}

function tbPiocher_(table) {
  if (table.paquet.length === 0) throw new Error('Paquet vide');
  return table.paquet.pop();
}

/* ---------- Actions des joueurs ---------- */

function tbAsseoir(table, cle, pseudo) {
  if (tbPlace_(table, cle)) throw tbErreur_('deja_assis');
  if (table.places.length >= TB.PLACES_MAX) throw tbErreur_('table_pleine');
  table.places.push({
    cle: cle, pseudo: pseudo, mise: 0, main: [], statut: 'attente',
    resultat: null, gain: 0, inactif: 0
  });
  return [];
}

/**
 * Quitter la table. Mise non distribuée : remboursée.
 * Main en cours : abandonnée (mise perdue), sinon on fuirait une main perdante.
 */
function tbQuitter(table, cle, maintenant) {
  var place = tbPlace_(table, cle);
  if (!place) throw tbErreur_('pas_assis');
  var mouvements = [];
  if (table.phase === 'mises' && place.statut === 'mise') {
    mouvements.push({ cle: cle, montant: place.mise, motif: 'remboursement' });
  }
  var etaitSonTour = table.phase === 'jeu' && table.tour === cle;
  table.places = table.places.filter(function (p) { return p.cle !== cle; });
  if (etaitSonTour) mouvements = mouvements.concat(tbPasserAuSuivant_(table, maintenant));
  return mouvements;
}

/** Enregistre la mise (le débit est fait par l'appelant, qui a vérifié le solde). */
function tbMiser(table, cle, mise, maintenant) {
  var place = tbPlace_(table, cle);
  if (!place) throw tbErreur_('pas_assis');
  if (table.phase !== 'mises') throw tbErreur_('mises_fermees');
  if (place.statut !== 'attente') throw tbErreur_('deja_mise');
  place.mise = mise;
  place.statut = 'mise';
  if (table.echeance === null) table.echeance = maintenant + TB.DUREE_MISES_MS;
  return [];
}

function tbExigerSonTour_(table, cle) {
  if (!tbPlace_(table, cle)) throw tbErreur_('pas_assis');
  if (table.phase !== 'jeu' || table.tour !== cle) throw tbErreur_('pas_ton_tour');
  return tbPlace_(table, cle);
}

function tbTirer(table, cle, maintenant) {
  var place = tbExigerSonTour_(table, cle);
  place.main.push(tbPiocher_(table));
  var total = bjTotal(place.main);
  if (total > 21) {
    place.statut = 'saute';
    return tbPasserAuSuivant_(table, maintenant);
  }
  if (total === 21) {
    place.statut = 'reste';
    return tbPasserAuSuivant_(table, maintenant);
  }
  table.echeance = maintenant + TB.DUREE_TOUR_MS;
  return [];
}

function tbRester(table, cle, maintenant) {
  var place = tbExigerSonTour_(table, cle);
  place.statut = 'reste';
  return tbPasserAuSuivant_(table, maintenant);
}

/* ---------- Déroulement de la manche ---------- */

function tbDistribuer_(table, maintenant, randInt) {
  table.paquet = bjMelanger(bjNouveauPaquet(), randInt);
  table.croupier = [];
  var joueurs = table.places.filter(function (p) { return p.statut === 'mise'; });
  for (var tourDeCarte = 0; tourDeCarte < 2; tourDeCarte++) {
    joueurs.forEach(function (p) { p.main.push(tbPiocher_(table)); });
    table.croupier.push(tbPiocher_(table));
  }
  joueurs.forEach(function (p) { p.statut = bjEstBlackjack(p.main) ? 'blackjack' : 'joue'; });
  table.phase = 'jeu';
  table.tour = null;
  if (bjEstBlackjack(table.croupier)) return tbRegler_(table, maintenant);
  return tbPasserAuSuivant_(table, maintenant);
}

function tbPasserAuSuivant_(table, maintenant) {
  for (var i = 0; i < table.places.length; i++) {
    if (table.places[i].statut === 'joue') {
      table.tour = table.places[i].cle;
      table.echeance = maintenant + TB.DUREE_TOUR_MS;
      return [];
    }
  }
  return tbRegler_(table, maintenant);
}

function tbRegler_(table, maintenant) {
  var enMain = table.places.filter(function (p) { return TB_STATUTS_EN_MAIN.indexOf(p.statut) >= 0; });
  var croupierDoitJouer = enMain.some(function (p) { return p.statut === 'reste'; });
  if (croupierDoitJouer) {
    while (bjTotal(table.croupier) < 17) table.croupier.push(tbPiocher_(table));
  }
  var mouvements = [];
  enMain.forEach(function (p) {
    p.resultat = bjResultat(p.main, table.croupier);
    p.gain = bjGain(p.resultat, p.mise);
    p.statut = 'fini';
    if (p.gain > 0) mouvements.push({ cle: p.cle, montant: p.gain, motif: 'gain:' + p.resultat });
  });
  table.phase = 'fin';
  table.tour = null;
  table.paquet = [];
  table.echeance = maintenant + TB.DUREE_FIN_MS;
  return mouvements;
}

function tbNouvelleManche_(table) {
  table.places.forEach(function (p) { p.inactif = p.mise > 0 ? 0 : p.inactif + 1; });
  table.places = table.places.filter(function (p) { return p.inactif < TB.MANCHES_INACTIF_MAX; });
  table.places.forEach(function (p) {
    p.mise = 0;
    p.main = [];
    p.statut = 'attente';
    p.resultat = null;
    p.gain = 0;
  });
  table.phase = 'mises';
  table.manche += 1;
  table.croupier = [];
  table.paquet = [];
  table.tour = null;
  table.echeance = null;
}

/** Vrai si tbAvancer() changerait quelque chose (évite de verrouiller pour rien). */
function tbTransitionDue(table, maintenant) {
  if (table.phase === 'mises') {
    var misees = table.places.filter(function (p) { return p.statut === 'mise'; }).length;
    if (misees === 0) return table.echeance !== null;
    return misees === table.places.length || maintenant >= table.echeance;
  }
  if (table.phase === 'jeu') return table.tour === null || maintenant >= table.echeance;
  if (table.phase === 'fin') return maintenant >= table.echeance;
  return false;
}

/** Applique toutes les transitions dues. Renvoie les mouvements de solde. */
function tbAvancer(table, maintenant, randInt) {
  var mouvements = [];
  for (var garde = 0; garde < 10 && tbTransitionDue(table, maintenant); garde++) {
    if (table.phase === 'mises') {
      var misees = table.places.filter(function (p) { return p.statut === 'mise'; }).length;
      if (misees === 0) table.echeance = null;
      else mouvements = mouvements.concat(tbDistribuer_(table, maintenant, randInt));
    } else if (table.phase === 'jeu') {
      var courant = table.tour === null ? null : tbPlace_(table, table.tour);
      if (courant) courant.statut = 'reste'; // temps écoulé : il reste
      mouvements = mouvements.concat(tbPasserAuSuivant_(table, maintenant));
    } else if (table.phase === 'fin') {
      tbNouvelleManche_(table);
    }
  }
  return mouvements;
}

/* ---------- Vue envoyée aux clients ---------- */

/**
 * Seule chose qui sort du serveur : jamais le paquet, jamais la carte cachée
 * du croupier pendant la phase de jeu, jamais la clé interne des joueurs.
 */
function tbVue(table, maintenant, cleMoi) {
  var croupier = table.phase === 'jeu' ? table.croupier.slice(0, 1) : table.croupier.slice();
  var tourPlace = table.tour === null ? null : tbPlace_(table, table.tour);
  return {
    phase: table.phase,
    manche: table.manche,
    placesMax: TB.PLACES_MAX,
    secondesRestantes: table.echeance === null ? null : Math.max(0, Math.ceil((table.echeance - maintenant) / 1000)),
    tour: tourPlace ? tourPlace.pseudo : null,
    monTour: table.phase === 'jeu' && table.tour === cleMoi,
    assis: tbPlace_(table, cleMoi) !== null,
    croupier: {
      cartes: croupier,
      carteCachee: table.phase === 'jeu',
      total: croupier.length ? bjTotal(croupier) : null
    },
    places: table.places.map(function (p) {
      return {
        pseudo: p.pseudo,
        moi: p.cle === cleMoi,
        mise: p.mise,
        cartes: p.main.slice(),
        total: p.main.length ? bjTotal(p.main) : null,
        statut: p.statut,
        resultat: p.resultat,
        gain: p.gain
      };
    })
  };
}
