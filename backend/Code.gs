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
  miser: actionMiser_,
  tirer: function (req) { return avecTable_(req, function (t, j, now) { return tbTirer(t, j.pseudo_norm, now); }); },
  rester: function (req) { return avecTable_(req, function (t, j, now) { return tbRester(t, j.pseudo_norm, now); }); },
  supprimerCompte: actionSupprimerCompte_,
  classement: actionClassement_
};

function doPost(e) {
  var reponse;
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
    journal_(pseudo, 'inscription', '');
    return { jeton: jeton, pseudo: pseudo, joursValidite: CONFIG.SESSION_JOURS };
  });
}

/** Interrogé en boucle par les clients. Ne verrouille que si une transition est due. */
function actionEtat_(req) {
  var joueur = authentifier_(req.jeton);
  var table = chargerTable_();
  if (tbTransitionDue(table, Date.now())) {
    table = avecVerrou_(function () {
      var t = chargerTable_();
      validerEtSauver_(t, tbAvancer(t, Date.now(), alea_()));
      return t;
    });
  }
  return reponseJoueur_(joueur.pseudo_norm, table);
}

function actionMiser_(req) {
  var mise = validerMise_(req.mise);
  return avecTable_(req, function (table, joueur, maintenant) {
    var frais = lireJoueur_(trouverLigne_(COL.pseudo_norm, joueur.pseudo_norm));
    var solde = frais.solde;
    var faillite = false;
    if (solde < CONFIG.MISE_MIN) { // faillite : on renfloue
      faillite = true;
      solde = CONFIG.SOLDE_INITIAL;
    }
    if (mise > solde) throw erreurClient_('solde_insuffisant');
    tbMiser(table, joueur.pseudo_norm, mise, maintenant);
    return [{
      cle: joueur.pseudo_norm,
      montant: (solde - frais.solde) - mise,
      motif: faillite ? 'faillite+mise' : 'mise',
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
    if (ligne > 0) feuille_(FEUILLE_JOUEURS).deleteRow(ligne);
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

  var f = feuille_(FEUILLE_JOUEURS);
  var n = f.getLastRow() - 1;
  var lignes = n > 0 ? f.getRange(2, 1, n, COL.solde).getValues() : [];
  var top = lignes
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
  return brut ? JSON.parse(brut) : tbNouvelle();
}

function sauverTable_(table) {
  PropertiesService.getScriptProperties().setProperty(PROP_TABLE, JSON.stringify(table));
}

function reponseJoueur_(cle, table) {
  var ligne = trouverLigne_(COL.pseudo_norm, cle);
  if (ligne < 0) throw erreurClient_('session_invalide');
  var j = lireJoueur_(ligne);
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
    f.getRange(ligne, COL.solde, 1, 2).setValues([[j.solde + m.montant, j.faillites + (m.faillite ? 1 : 0)]]);
    f.getRange(ligne, COL.maj_le).setValue(new Date());
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

function authentifier_(jeton) {
  if (typeof jeton !== 'string' || !/^[0-9a-f]{64}$/.test(jeton)) throw erreurClient_('session_invalide');
  var empreinte = sha256Hex_(jeton);
  limiter_('r:' + empreinte, CONFIG.MAX_REQUETES_MINUTE, 60);

  var ligne = trouverLigne_(COL.jeton_hash, empreinte);
  if (ligne < 0) throw erreurClient_('session_invalide');
  var joueur = lireJoueur_(ligne);
  var maintenant = Date.now();
  if (!(joueur.jeton_expire > maintenant)) throw erreurClient_('session_invalide');

  // Expiration glissante, renouvelée au plus une fois par jour (une seule cellule écrite).
  if (joueur.jeton_expire - maintenant < (CONFIG.SESSION_JOURS - 1) * JOUR_MS) {
    feuille_(FEUILLE_JOUEURS).getRange(ligne, COL.jeton_expire).setValue(maintenant + CONFIG.SESSION_JOURS * JOUR_MS);
  }
  return joueur;
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

function feuille_(nom) {
  var f = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nom);
  if (!f) throw new Error('Feuille manquante : ' + nom + ' (lancez initialiser())');
  return f;
}

/** Numéro de ligne dont la colonne `col` vaut exactement `valeur`, ou -1. */
function trouverLigne_(col, valeur) {
  var f = feuille_(FEUILLE_JOUEURS);
  var n = f.getLastRow() - 1;
  if (n < 1) return -1;
  var cellule = f.getRange(2, col, n, 1)
    .createTextFinder(String(valeur))
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();
  return cellule ? cellule.getRow() : -1;
}

function lireJoueur_(ligne) {
  var v = feuille_(FEUILLE_JOUEURS).getRange(ligne, 1, 1, ENTETES_JOUEURS.length).getValues()[0];
  return {
    ligne: ligne,
    pseudo: String(v[COL.pseudo - 1]),
    pseudo_norm: String(v[COL.pseudo_norm - 1]),
    jeton_hash: String(v[COL.jeton_hash - 1]),
    jeton_expire: Number(v[COL.jeton_expire - 1]) || 0,
    solde: Number(v[COL.solde - 1]) || 0,
    faillites: Number(v[COL.faillites - 1]) || 0
  };
}

/** Journal d'audit (lecture réservée au propriétaire du Sheet). */
function journal_(pseudo, evenement, detail) {
  feuille_(FEUILLE_JOURNAL).appendRow(neutraliserLigne_([new Date(), pseudo, evenement, detail]));
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

function avecVerrou_(fn) {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(CONFIG.VERROU_ATTENTE_MS)) throw erreurClient_('serveur_occupe');
  try {
    return fn();
  } finally {
    verrou.releaseLock();
  }
}

/** Limiteur à fenêtre glissante via CacheService (Apps Script ne fournit pas l'IP). */
function limiter_(cle, max, fenetreS) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('rl:' + cle) || 0);
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
