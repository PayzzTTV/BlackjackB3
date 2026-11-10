/**
 * Blackjack B3 : point d'entrée HTTP (Web App Google Apps Script).
 *
 * Le navigateur n'a AUCUNE autorité : il envoie des intentions, ce script
 * décide de tout (cartes, soldes, tours) et ne renvoie que ce qui est public.
 *
 * Requête : POST, corps JSON  { "action": "...", "jeton": "...", ... }
 * Réponse : { "ok": true, "data": {...} } | { "ok": false, "erreur": "code", "message": "..." }
 */

var CONFIG = {
  SOLDE_INITIAL: 1000,
  MISE_MIN: 10,
  MISE_MAX: 500,
  SESSION_JOURS: 30,
  MAX_INSCRIPTIONS_HEURE: 30,   // global : anti-flood de comptes
  MAX_REQUETES_MINUTE: 90,      // par session (le client interroge toutes les ~3 s)
  TAILLE_MAX_CORPS: 1024,       // octets
  CLASSEMENT_CACHE_S: 60,
  FICHE_CACHE_S: 1800,          // fiche joueur en cache (voir « Fiches joueur »)
  VERROU_ATTENTE_MS: 10000
};

var FEUILLE_JOUEURS = 'Joueurs';
var FEUILLE_JOURNAL = 'Journal';
var ENTETES_JOUEURS = ['pseudo', 'pseudo_norm', 'jeton_hash', 'jeton_expire', 'solde', 'faillites', 'cree_le', 'maj_le'];
var COL = { pseudo: 1, pseudo_norm: 2, jeton_hash: 3, jeton_expire: 4, solde: 5, faillites: 6, cree_le: 7, maj_le: 8 };
var PROP_TABLE = 'TABLE';
var PSEUDOS_RESERVES = ['croupier', 'admin', 'administrateur', 'root', 'system', 'moderateur'];
var JOUR_MS = 24 * 3600 * 1000;

var MESSAGES = {
  requete_invalide: 'Requête invalide.',
  action_inconnue: 'Action inconnue.',
  pseudo_invalide: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, _).',
  pseudo_pris: 'Ce pseudo est déjà pris.',
  session_invalide: 'Session expirée ou invalide. Créez un nouveau pseudo.',
  trop_de_requetes: 'Trop de requêtes, patientez un instant.',
  serveur_occupe: 'Serveur occupé, réessayez.',
  mise_invalide: 'Mise invalide : nombre entier entre ' + CONFIG.MISE_MIN + ' et ' + CONFIG.MISE_MAX + '.',
  solde_insuffisant: 'Solde insuffisant.',
  deja_assis: 'Vous êtes déjà à la table.',
  table_pleine: 'La table est pleine.',
  pas_assis: 'Asseyez-vous d\'abord à la table.',
  mises_fermees: 'Les mises sont fermées, attendez la prochaine manche.',
  deja_mise: 'Vous avez déjà misé pour cette manche.',
  pas_ton_tour: 'Ce n\'est pas votre tour.'
};

/* =====================================================================
 * Routage
 * ===================================================================== */

var ACTIONS = {
  inscription: actionInscription_,
  etat: actionEtat_,
  asseoir: function (req) { return avecTable_(req, function (t, j, now) { return tbAsseoir(t, j.pseudo_norm, j.pseudo); }); },
  quitter: function (req) { return avecTable_(req, function (t, j, now) { return tbQuitter(t, j.pseudo_norm, now); }); },
  miser: function (req) { return actionMiser_(req, validerMise_(req.mise)); },
  toutMiser: function (req) { return actionMiser_(req, null); }, // all-in : tout le solde
  tirer: function (req) { return avecTable_(req, function (t, j, now) { return tbTirer(t, j.pseudo_norm, now); }); },
  rester: function (req) { return avecTable_(req, function (t, j, now) { return tbRester(t, j.pseudo_norm, now); }); },
  supprimerCompte: actionSupprimerCompte_,
  classement: actionClassement_
};

function doPost(e) {
  var reponse;
  memo_ = nouveauMemo_();
  try {
    var corps = (e && e.postData && typeof e.postData.contents === 'string') ? e.postData.contents : '';
    if (corps.length === 0 || corps.length > CONFIG.TAILLE_MAX_CORPS) throw erreurClient_('requete_invalide');
    var req;
    try {
      req = JSON.parse(corps);
    } catch (_) {
      throw erreurClient_('requete_invalide');
    }
    if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.action !== 'string') {
      throw erreurClient_('requete_invalide');
    }
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) throw erreurClient_('action_inconnue');
    reponse = { ok: true, data: ACTIONS[req.action](req) };
  } catch (err) {
    if (err && err.codeClient) {
      reponse = { ok: false, erreur: err.codeClient, message: MESSAGES[err.codeClient] || 'Erreur.' };
    } else {
      console.error(err && err.stack ? err.stack : err); // visible seulement par le propriétaire
      reponse = { ok: false, erreur: 'erreur_serveur', message: 'Erreur interne, réessayez.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(reponse)).setMimeType(ContentService.MimeType.JSON);
}

/** Aucune lecture par GET : pas de fuite via l'historique, les logs ou le Referer. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, erreur: 'methode_non_autorisee' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
 * Actions
 * ===================================================================== */

function actionInscription_(req) {
  var pseudo = validerPseudo_(req.pseudo);
  var norm = pseudo.toLowerCase();
  if (PSEUDOS_RESERVES.indexOf(norm) >= 0) throw erreurClient_('pseudo_pris');

  return avecVerrou_(function () {
    limiter_('inscriptions', CONFIG.MAX_INSCRIPTIONS_HEURE, 3600);
    if (trouverLigne_(COL.pseudo_norm, norm) > 0) throw erreurClient_('pseudo_pris');

    var jeton = genererJeton_();
    var maintenant = new Date();
    feuille_(FEUILLE_JOUEURS).appendRow(neutraliserLigne_([
      pseudo, norm, sha256Hex_(jeton), Date.now() + CONFIG.SESSION_JOURS * JOUR_MS,
      CONFIG.SOLDE_INITIAL, 0, maintenant, maintenant
    ]));
    memo_.joueurs = null;
    noterFiche_(lireJoueur_(trouverLigne_(COL.pseudo_norm, norm)));
    journal_(pseudo, 'inscription', '');
    return { jeton: jeton, pseudo: pseudo, joursValidite: CONFIG.SESSION_JOURS };
  });
}

/**
 * Interrogé en boucle par les clients (95 % du trafic). Chemin normal : fiche
 * joueur en cache + table, AUCUN accès au Sheet. Ne verrouille que si une
 * transition est due, ou pour remettre la fiche en cache.
 */
function actionEtat_(req) {
  var joueur = authentifier_(req.jeton, true);
  var table = chargerTable_();
  if (tbTransitionDue(table, Date.now())) {
    // Si le verrou est pris, une autre requête est déjà en train de faire avancer
    // la table : inutile de faire la queue, on renvoie l'état lu (le client
    // re-sonde dans 2,5 s). Évite que tous les clients s'empilent sur le verrou.
    var avancee = avecVerrou_(function () {
      var t = chargerTable_();
      validerEtSauver_(t, tbAvancer(t, Date.now(), alea_()));
      return t;
    }, 0);
    if (avancee) table = avancee;
    // Des soldes ont pu bouger sous le verrou : on relit la fiche à jour.
    if (avancee) return reponseJoueur_(joueur.pseudo_norm, table);
  }
  return reponseJoueur_(joueur.pseudo_norm, table, joueur);
}

/**
 * Mise `mise` (déjà validée), ou tout le solde si `mise` est null (all-in).
 * Le montant de l'all-in est calculé ici, sous verrou, à partir du solde relu :
 * le client n'envoie aucun montant. Il échappe à MISE_MAX (c'est le principe),
 * pas à MISE_MIN : après renflouement, le solde vaut au moins SOLDE_INITIAL.
 */
function actionMiser_(req, mise) {
  return avecTable_(req, function (table, joueur, maintenant) {
    var frais = lireJoueur_(trouverLigne_(COL.pseudo_norm, joueur.pseudo_norm)); // relu sous verrou
    var solde = frais.solde;
    var faillite = false;
    if (solde < CONFIG.MISE_MIN) { // faillite : on renfloue
      faillite = true;
      solde = CONFIG.SOLDE_INITIAL;
    }
    if (mise === null) mise = solde;
    if (mise > solde) throw erreurClient_('solde_insuffisant');
    tbMiser(table, joueur.pseudo_norm, mise, maintenant);
    return [{
      cle: joueur.pseudo_norm,
      montant: (solde - frais.solde) - mise,
      motif: (faillite ? 'faillite+' : '') + (req.action === 'toutMiser' ? 'all_in' : 'mise'),
      faillite: faillite
    }];
  });
}

/** Sans mot de passe, se déconnecter = supprimer le compte et libérer le pseudo. */
function actionSupprimerCompte_(req) {
  var joueur = authentifier_(req.jeton);
  return avecVerrou_(function () {
    var table = chargerTable_();
    if (tbPlace_(table, joueur.pseudo_norm)) {
      var mouvements = tbQuitter(table, joueur.pseudo_norm, Date.now())
        .filter(function (m) { return m.cle !== joueur.pseudo_norm; });
      validerEtSauver_(table, mouvements);
    }
    var ligne = trouverLigne_(COL.pseudo_norm, joueur.pseudo_norm);
    if (ligne > 0) {
      feuille_(FEUILLE_JOUEURS).deleteRow(ligne);
      memo_.joueurs = null;
    }
    memo_.fiches[joueur.jeton_hash] = null; // retirée du cache avant la fin du verrou
    journal_(joueur.pseudo, 'suppression_compte', '');
    CacheService.getScriptCache().remove('classement');
    return { supprime: true };
  });
}

/** Public, mis en cache 60 s : n'expose que pseudo et solde. */
function actionClassement_() {
  var cache = CacheService.getScriptCache();
  var enCache = cache.get('classement');
  if (enCache) return JSON.parse(enCache);

  var top = joueurs_()
    .map(function (l) { return { pseudo: String(l[COL.pseudo - 1]), solde: Number(l[COL.solde - 1]) || 0 }; })
    .sort(function (a, b) { return b.solde - a.solde; })
    .slice(0, 10);
  var resultat = { top: top };
  cache.put('classement', JSON.stringify(resultat), CONFIG.CLASSEMENT_CACHE_S);
  return resultat;
}

/* =====================================================================
 * Table : chargement, sauvegarde, exécution atomique
 * ===================================================================== */

/**
 * Exécute une action de jeu sous verrou :
 *   1. applique les transitions dues (temps écoulés) et les enregistre ;
 *   2. exécute l'action (qui vérifie tout AVANT de modifier quoi que ce soit) ;
 *   3. applique les transitions déclenchées par l'action (ex. tout le monde a misé).
 * Si l'action est refusée, seule l'étape 1 est conservée.
 */
function avecTable_(req, action) {
  var joueur = authentifier_(req.jeton);
  return avecVerrou_(function () {
    var randInt = alea_();
    var table = chargerTable_();
    var maintenant = Date.now();
    validerEtSauver_(table, tbAvancer(table, maintenant, randInt));

    var mouvements;
    try {
      mouvements = action(table, joueur, maintenant) || [];
    } catch (err) {
      if (err && err.codeTable) throw erreurClient_(err.codeTable);
      throw err;
    }
    mouvements = mouvements.concat(tbAvancer(table, maintenant, randInt));
    validerEtSauver_(table, mouvements);
    return reponseJoueur_(joueur.pseudo_norm, table);
  });
}

/**
 * Sauvegarde la table PUIS applique les mouvements de solde. En cas de panne
 * entre les deux, un joueur peut perdre un gain (visible dans le Journal et
 * corrigeable), mais aucun jeton ne peut être crédité deux fois.
 */
function validerEtSauver_(table, mouvements) {
  sauverTable_(table);
  appliquerMouvements_(mouvements);
}

function chargerTable_() {
  var brut = PropertiesService.getScriptProperties().getProperty(PROP_TABLE);
  memo_.tableBrut = brut;
  return brut ? JSON.parse(brut) : tbNouvelle();
}

/** N'écrit que si la table a changé depuis la dernière lecture ou écriture. */
function sauverTable_(table) {
  var brut = JSON.stringify(table);
  if (brut === memo_.tableBrut) return;
  PropertiesService.getScriptProperties().setProperty(PROP_TABLE, brut);
  memo_.tableBrut = brut;
}

/**
 * Vue renvoyée au joueur. `connu` : fiche déjà lue par authentifier_ hors
 * verrou (sondage etat) ; sinon on relit le Sheet, et sous verrou la fiche
 * relue est remise en cache.
 */
function reponseJoueur_(cle, table, connu) {
  var j = connu;
  if (!j) {
    var ligne = trouverLigne_(COL.pseudo_norm, cle);
    if (ligne < 0) throw erreurClient_('session_invalide');
    j = lireJoueur_(ligne);
    noterFiche_(j);
  }
  return {
    moi: { pseudo: j.pseudo, solde: j.solde },
    regles: { miseMin: CONFIG.MISE_MIN, miseMax: CONFIG.MISE_MAX },
    table: tbVue(table, Date.now(), cle)
  };
}

/** Applique les mouvements de solde au Sheet (appelé sous verrou). */
function appliquerMouvements_(mouvements) {
  var f = feuille_(FEUILLE_JOUEURS);
  mouvements.forEach(function (m) {
    if (!m.montant && !m.faillite) return;
    var ligne = trouverLigne_(COL.pseudo_norm, m.cle);
    if (ligne < 0) return; // compte supprimé entre-temps
    var j = lireJoueur_(ligne);
    // Une seule écriture pour solde, faillites, cree_le (réécrit tel quel) et maj_le.
    var valeurs = [j.solde + m.montant, j.faillites + (m.faillite ? 1 : 0), j.cree_le, new Date()];
    f.getRange(ligne, COL.solde, 1, valeurs.length).setValues([valeurs]);
    majMemo_(ligne, COL.solde, valeurs);
    noterFiche_(lireJoueur_(ligne));
    journal_(j.pseudo, m.motif, String(m.montant));
  });
}

/* =====================================================================
 * Sessions (jeton porté par le cookie côté client)
 * ===================================================================== */

/**
 * Jeton = 2 UUID v4 (générateur cryptographique de Google) = 244 bits d'aléa.
 * Seule son empreinte SHA-256 est stockée : une fuite du Sheet ne permet pas
 * d'usurper une session.
 */
function genererJeton_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

/**
 * Vérifie le jeton et renvoie la fiche du joueur. Le compteur anti-flood et la
 * fiche en cache sont lus en UN appel ; si la fiche est en cache, valide et
 * sans renouvellement dû, le Sheet n'est pas lu du tout.
 * `remplirCache` (sondage etat) : en cas d'absence, la lecture du Sheet se fait
 * sous verrou si celui-ci est libre, pour pouvoir remettre la fiche en cache.
 */
function authentifier_(jeton, remplirCache) {
  if (typeof jeton !== 'string' || !/^[0-9a-f]{64}$/.test(jeton)) throw erreurClient_('session_invalide');
  var empreinte = sha256Hex_(jeton);
  var cleLimite = 'r:' + empreinte;
  var lu = CacheService.getScriptCache().getAll(['rl:' + cleLimite, cleFiche_(empreinte)]);
  limiter_(cleLimite, CONFIG.MAX_REQUETES_MINUTE, 60, lu['rl:' + cleLimite] || null); // absent = 0

  var fiche = lireFiche_(lu[cleFiche_(empreinte)]);
  if (fiche && fiche.jeton_hash === empreinte && !renouvellementDu_(fiche)) return fiche;

  if (remplirCache) {
    var sousVerrou = avecVerrou_(function () { return joueurDepuisSheet_(empreinte); }, 0);
    if (sousVerrou) return sousVerrou;
  }
  return joueurDepuisSheet_(empreinte);
}

function renouvellementDu_(joueur) {
  var maintenant = Date.now();
  if (!(joueur.jeton_expire > maintenant)) throw erreurClient_('session_invalide');
  return joueur.jeton_expire - maintenant < (CONFIG.SESSION_JOURS - 1) * JOUR_MS;
}

/** Lit le joueur dans le Sheet, renouvelle la session si besoin, met la fiche en cache (sous verrou). */
function joueurDepuisSheet_(empreinte) {
  var ligne = trouverLigne_(COL.jeton_hash, empreinte);
  if (ligne < 0) throw erreurClient_('session_invalide');
  var joueur = lireJoueur_(ligne);
  var maintenant = Date.now();
  if (!(joueur.jeton_expire > maintenant)) throw erreurClient_('session_invalide');

  // Expiration glissante, renouvelée au plus une fois par jour (une seule cellule écrite).
  if (joueur.jeton_expire - maintenant < (CONFIG.SESSION_JOURS - 1) * JOUR_MS) {
    var expire = maintenant + CONFIG.SESSION_JOURS * JOUR_MS;
    feuille_(FEUILLE_JOUEURS).getRange(ligne, COL.jeton_expire).setValue(expire);
    majMemo_(ligne, COL.jeton_expire, [expire]);
    joueur.jeton_expire = expire;
  }
  noterFiche_(joueur);
  return joueur;
}

/* =====================================================================
 * Fiches joueur en cache
 *
 * Mesuré en ligne : une lecture du Sheet coûte 0,5 à 2 s, une lecture du
 * cache quelques millisecondes. La fiche (pseudo, solde, expiration) est donc
 * gardée dans CacheService, clé = empreinte du jeton.
 *
 * Cohérence : une fiche n'est ÉCRITE que sous le verrou, après lecture du
 * Sheet sous ce même verrou. Toutes les écritures de solde ayant lieu sous le
 * verrou, une fiche ne peut jamais être écrasée par une lecture plus ancienne.
 * Elle ne sert qu'à authentifier et à afficher : toute décision sur l'argent
 * (miser) relit le Sheet sous verrou.
 * Après une modification À LA MAIN du Sheet, lancer viderCacheJoueurs().
 * ===================================================================== */

function cleFiche_(empreinte) {
  return 'j:' + empreinte;
}

/** Retient la fiche à écrire en cache en fin de verrou (ignoré hors verrou). */
function noterFiche_(j) {
  if (!memo_.sousVerrou || !j || !j.jeton_hash) return;
  memo_.fiches[j.jeton_hash] = {
    pseudo: j.pseudo, pseudo_norm: j.pseudo_norm, jeton_hash: j.jeton_hash,
    jeton_expire: j.jeton_expire, solde: j.solde, faillites: j.faillites
  };
}

function lireFiche_(brut) {
  if (!brut) return null;
  try {
    return JSON.parse(brut);
  } catch (_) {
    return null;
  }
}

/** Écrit (ou retire) les fiches retenues, en un appel chacun (appelé sous verrou). */
function viderFiches_() {
  var aEcrire = {};
  var aRetirer = [];
  var n = 0;
  Object.keys(memo_.fiches).forEach(function (h) {
    if (memo_.fiches[h] === null) aRetirer.push(cleFiche_(h));
    else { aEcrire[cleFiche_(h)] = JSON.stringify(memo_.fiches[h]); n++; }
  });
  memo_.fiches = {};
  var cache = CacheService.getScriptCache();
  try {
    if (n) cache.putAll(aEcrire, CONFIG.FICHE_CACHE_S);
  } catch (err) {
    // Échec d'écriture : on retire ces fiches pour ne pas laisser d'anciennes valeurs.
    aRetirer = aRetirer.concat(Object.keys(aEcrire));
    console.error(err && err.stack ? err.stack : err);
  }
  if (aRetirer.length) cache.removeAll(aRetirer);
}

/* =====================================================================
 * Validation des entrées
 * ===================================================================== */

function validerPseudo_(p) {
  if (typeof p !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(p)) throw erreurClient_('pseudo_invalide');
  return p;
}

function validerMise_(m) {
  if (typeof m !== 'number' || !Number.isInteger(m) || m < CONFIG.MISE_MIN || m > CONFIG.MISE_MAX) {
    throw erreurClient_('mise_invalide');
  }
  return m;
}

/* =====================================================================
 * Accès au Sheet
 * ===================================================================== */

/*
 * Chaque appel à SpreadsheetApp est un aller-retour réseau (souvent 50 à 300 ms).
 * On garde donc, le temps d'UNE requête, le classeur, les onglets et une copie
 * de l'onglet Joueurs lue en un seul getValues(). Cette copie est relue à
 * l'entrée de chaque section verrouillée (voir avecVerrou_) et tenue à jour à
 * chaque écriture : elle n'est jamais plus ancienne que la requête en cours.
 */
var memo_ = nouveauMemo_();

function nouveauMemo_() {
  return { classeur: null, feuilles: {}, joueurs: null, tableBrut: null, journal: [], fiches: {}, sousVerrou: false };
}

function feuille_(nom) {
  if (!memo_.feuilles[nom]) {
    if (!memo_.classeur) memo_.classeur = SpreadsheetApp.getActiveSpreadsheet();
    var f = memo_.classeur.getSheetByName(nom);
    if (!f) throw new Error('Feuille manquante : ' + nom + ' (lancez initialiser())');
    memo_.feuilles[nom] = f;
  }
  return memo_.feuilles[nom];
}

/** Toutes les lignes de Joueurs (sans l'en-tête), lues une fois par requête. */
function joueurs_() {
  if (!memo_.joueurs) {
    // getDataRange() : un seul aller-retour (getLastRow() + getRange() en coûtait deux).
    var lignes = feuille_(FEUILLE_JOUEURS).getDataRange().getValues();
    lignes.shift(); // en-tête
    memo_.joueurs = lignes;
  }
  return memo_.joueurs;
}

/** Reporte dans la copie en mémoire une écriture faite sur le Sheet. */
function majMemo_(ligne, col, valeurs) {
  if (!memo_.joueurs) return;
  var l = memo_.joueurs[ligne - 2];
  if (!l) { memo_.joueurs = null; return; }
  for (var i = 0; i < valeurs.length; i++) l[col - 1 + i] = valeurs[i];
}

/**
 * Numéro de ligne dont la colonne `col` vaut exactement `valeur`, ou -1.
 * Colonnes A:C au format texte brut : la valeur lue est la chaîne affichée.
 */
function trouverLigne_(col, valeur) {
  var lignes = joueurs_();
  var cible = String(valeur);
  for (var i = 0; i < lignes.length; i++) {
    if (String(lignes[i][col - 1]) === cible) return i + 2;
  }
  return -1;
}

function lireJoueur_(ligne) {
  var v = joueurs_()[ligne - 2] || [];
  return {
    ligne: ligne,
    pseudo: String(v[COL.pseudo - 1]),
    pseudo_norm: String(v[COL.pseudo_norm - 1]),
    jeton_hash: String(v[COL.jeton_hash - 1]),
    jeton_expire: Number(v[COL.jeton_expire - 1]) || 0,
    solde: Number(v[COL.solde - 1]) || 0,
    faillites: Number(v[COL.faillites - 1]) || 0,
    cree_le: v[COL.cree_le - 1]
  };
}

/** Journal d'audit (lecture réservée au propriétaire du Sheet). */
function journal_(pseudo, evenement, detail) {
  memo_.journal.push(neutraliserLigne_([new Date(), pseudo, evenement, detail]));
}

/** Écrit les lignes de journal en attente en un seul appel (sous verrou). */
function viderJournal_() {
  var lignes = memo_.journal;
  if (!lignes.length) return;
  memo_.journal = [];
  var f = feuille_(FEUILLE_JOURNAL);
  if (lignes.length === 1) f.appendRow(lignes[0]);
  else f.getRange(f.getLastRow() + 1, 1, lignes.length, lignes[0].length).setValues(lignes);
}

/**
 * Anti-injection de formule : toute chaîne commençant par = + - @ (ou
 * tabulation / retour chariot) est préfixée d'une apostrophe.
 */
function neutraliserCellule_(v) {
  return (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;
}

function neutraliserLigne_(ligne) {
  return ligne.map(neutraliserCellule_);
}

/* =====================================================================
 * Utilitaires de sécurité
 * ===================================================================== */

function erreurClient_(code) {
  var e = new Error(code);
  e.codeClient = code;
  return e;
}

/**
 * Exécute fn sous le verrou global. Sans `attenteMs`, attend jusqu'à
 * VERROU_ATTENTE_MS puis renvoie « serveur occupé » ; avec, renvoie null si le
 * verrou n'est pas obtenu à temps (l'appelant décide quoi faire).
 */
function avecVerrou_(fn, attenteMs) {
  var verrou = LockService.getScriptLock();
  var facultatif = typeof attenteMs === 'number';
  if (!verrou.tryLock(facultatif ? attenteMs : CONFIG.VERROU_ATTENTE_MS)) {
    if (facultatif) return null;
    throw erreurClient_('serveur_occupe');
  }
  memo_.joueurs = null; // une autre requête a pu écrire pendant l'attente : on relira
  memo_.sousVerrou = true;
  try {
    return fn();
  } finally {
    try {
      viderJournal_();
    } finally {
      try {
        viderFiches_();
      } finally {
        memo_.sousVerrou = false;
        verrou.releaseLock();
      }
    }
  }
}

/** Limiteur à fenêtre glissante via CacheService (Apps Script ne fournit pas l'IP). */
function limiter_(cle, max, fenetreS, dejaLu) {
  var cache = CacheService.getScriptCache();
  var n = Number((typeof dejaLu === 'undefined' ? cache.get('rl:' + cle) : dejaLu) || 0);
  if (n >= max) throw erreurClient_('trop_de_requetes');
  cache.put('rl:' + cle, String(n + 1), fenetreS);
}

/** Aléa cryptographique : UUID v4 (SecureRandom) -> SHA-256 -> tirage par rejet. */
function alea_() {
  return bjCreerTirage(function () {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  });
}

function sha256Hex_(texte) {
  var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texte, Utilities.Charset.UTF_8);
  return octets.map(function (o) { return ('0' + (o & 0xff).toString(16)).slice(-2); }).join('');
}

/* =====================================================================
 * Administration (à lancer depuis l'éditeur Apps Script, jamais exposé)
 * ===================================================================== */

/** À exécuter UNE fois après avoir collé le code : crée les onglets. */
function initialiser() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [[FEUILLE_JOUEURS, ENTETES_JOUEURS], [FEUILLE_JOURNAL, ['date', 'pseudo', 'evenement', 'detail']]]
    .forEach(function (def) {
      var f = ss.getSheetByName(def[0]) || ss.insertSheet(def[0]);
      if (f.getLastRow() === 0) f.appendRow(def[1]);
      f.setFrozenRows(1);
    });
  // Colonnes texte au format « texte brut » : un pseudo comme "007" ou "1e5" reste une chaîne.
  var joueurs = ss.getSheetByName(FEUILLE_JOUEURS);
  joueurs.getRange('A:C').setNumberFormat('@');
  ss.getSheetByName(FEUILLE_JOURNAL).getRange('B:D').setNumberFormat('@');
  if (!PropertiesService.getScriptProperties().getProperty(PROP_TABLE)) sauverTable_(tbNouvelle());
  console.log('Initialisation terminée.');
}

/** À lancer après toute modification À LA MAIN de l'onglet Joueurs (solde, expiration...). */
function viderCacheJoueurs() {
  memo_ = nouveauMemo_();
  var cles = joueurs_().map(function (l) { return cleFiche_(String(l[COL.jeton_hash - 1])); });
  for (var i = 0; i < cles.length; i += 500) CacheService.getScriptCache().removeAll(cles.slice(i, i + 500));
  console.log(cles.length + ' fiche(s) retirée(s) du cache.');
}

/** Vide la table (en cas de blocage). Les mises en cours sont remboursées. */
function reinitialiserTable() {
  avecVerrou_(function () {
    var table = chargerTable_();
    var remboursements = table.places
      .filter(function (p) { return p.mise > 0 && p.statut !== 'fini'; })
      .map(function (p) { return { cle: p.cle, montant: p.mise, motif: 'remboursement_admin' }; });
    validerEtSauver_(tbNouvelle(), remboursements);
  });
  console.log('Table réinitialisée.');
}
