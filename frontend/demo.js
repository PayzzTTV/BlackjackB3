/*
 * Blackjack B3 : mode démo local (rôle B).
 *
 * But : travailler l'interface SANS l'API Google. Ce fichier remplace `window.fetch`
 * par un faux serveur qui tourne dans la page et répond exactement comme
 * backend/Code.gs ({ ok, data } ou { ok:false, erreur, message }).
 *
 * - Chargé uniquement par demo.html, AVANT app.js (index.html ne le charge jamais).
 * - La table et le classement démarrent vides : aucun joueur fictif, seuls les vrais
 *   joueurs (onglets) apparaissent.
 * - Un petit panneau permet de simuler un serveur lent ou injoignable,
 *   pour tester les états de chargement.
 * - L'état est gardé dans localStorage (clé bj_demo_etat) : un rechargement de page
 *   conserve votre pseudo. Le bouton « Réinitialiser » repart de zéro.
 *
 * Les règles sont un portage simplifié de backend/Table.gs et backend/Blackjack.gs.
 * Si A change une règle côté serveur, il faut la reporter ici (sinon seule la démo diverge,
 * le vrai jeu n'est pas touché).
 *
 * Sécurité : même règle que app.js, aucun innerHTML, uniquement createElement/textContent.
 */
(function () {
  'use strict';

  /* ---------------- Configuration de la démo ---------------- */

  // Cookie propre à la démo : ne JAMAIS réutiliser le cookie de session du vrai jeu (même
  // origine), sinon ouvrir la démo efface ou écrase la session réelle du joueur.
  var NOM_COOKIE_DEMO = '__Host-bj_demo';

  // URL factice : jamais contactée, fetch est intercepté plus bas.
  window.BJ_CONFIG = Object.freeze({
    API_URL: 'https://demo.invalid/exec',
    INTERVALLE_MS: 1500,
    NOM_COOKIE: NOM_COOKIE_DEMO,
    DEMO: true
  });

  /** Mêmes valeurs que CONFIG (Code.gs) et TB (Table.gs), durées comprises. */
  var R = {
    SOLDE_INITIAL: 1000,
    MISE_MIN: 10,
    MISE_MAX: 500,
    SESSION_JOURS: 30,
    PLACES_MAX: 5,
    DUREE_MISES_MS: 8000,
    DUREE_TOUR_MS: 15000,
    DUREE_FIN_MS: 5000,
    MANCHES_INACTIF_MAX: 3
  };

  var MESSAGES = {
    action_inconnue: 'Action inconnue.',
    pseudo_invalide: 'Pseudo invalide : 3 à 16 caractères (lettres, chiffres, _).',
    pseudo_pris: 'Ce pseudo est déjà pris.',
    session_invalide: 'Session expirée ou invalide. Créez un nouveau pseudo.',
    mise_invalide: 'Mise invalide : nombre entier entre ' + R.MISE_MIN + ' et ' + R.MISE_MAX + '.',
    solde_insuffisant: 'Solde insuffisant.',
    deja_assis: 'Vous êtes déjà à la table.',
    table_pleine: 'La table est pleine.',
    pas_assis: 'Asseyez-vous d\'abord à la table.',
    mises_fermees: 'Les mises sont fermées, attendez la prochaine manche.',
    deja_mise: 'Vous avez déjà misé pour cette manche.',
    pas_ton_tour: 'Ce n\'est pas votre tour.'
  };

  var PSEUDOS_RESERVES = ['croupier', 'admin', 'administrateur', 'root', 'system', 'moderateur'];
  var CLE_STOCKAGE = 'bj_demo_etat';

  /** Réglages modifiables depuis le panneau de démo. */
  var reglages = { latenceMs: 300, horsLigne: false };

  /* ---------------- Règles du blackjack (portage de Blackjack.gs) ---------------- */

  var RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var COULEURS = ['S', 'H', 'D', 'C'];

  /** Entier uniforme dans [0, n) via crypto (même exigence que le serveur, même en démo). */
  function tirage(n) {
    var limite = 4294967296 - (4294967296 % n);
    var x = new Uint32Array(1);
    do { crypto.getRandomValues(x); } while (x[0] >= limite);
    return x[0] % n;
  }

  function paquetMelange() {
    var p = [];
    COULEURS.forEach(function (c) { RANGS.forEach(function (r) { p.push(r + c); }); });
    for (var i = p.length - 1; i > 0; i--) {
      var j = tirage(i + 1);
      var t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }

  function valeur(carte) {
    var r = carte.slice(0, -1);
    if (r === 'A') return 11;
    if (r === 'J' || r === 'Q' || r === 'K') return 10;
    return parseInt(r, 10);
  }

  function total(main) {
    var t = 0, as = 0;
    main.forEach(function (c) { var v = valeur(c); t += v; if (v === 11) as++; });
    while (t > 21 && as > 0) { t -= 10; as--; }
    return t;
  }

  function estBlackjack(main) { return main.length === 2 && total(main) === 21; }

  function resultat(mj, mc) {
    var j = total(mj), c = total(mc);
    if (j > 21) return 'perdu';
    if (estBlackjack(mj) && estBlackjack(mc)) return 'egalite';
    if (estBlackjack(mj)) return 'blackjack';
    if (estBlackjack(mc)) return 'perdu';
    if (c > 21 || j > c) return 'gagne';
    if (j === c) return 'egalite';
    return 'perdu';
  }

  function gain(res, mise) {
    if (res === 'blackjack') return mise + Math.floor((mise * 3) / 2);
    if (res === 'gagne') return mise * 2;
    if (res === 'egalite') return mise;
    return 0;
  }

  /* ---------------- État du faux serveur ---------------- */

  /** Table neuve et vide : aucun joueur fictif, ni à table ni au classement. */
  function etatInitial() {
    return {
      joueurs: {},
      table: {
        phase: 'mises', manche: 1, places: [], croupier: [], paquet: [],
        tour: null, echeance: null
      }
    };
  }

  /**
   * Retire les joueurs fictifs d'un état sauvegardé par une ancienne version de la démo :
   * bots (joueurs marqués `bot`, leurs places à table, champ botAgitA) et figurants du classement.
   */
  function purgerFictifs(e) {
    delete e.figurants;
    Object.keys(e.joueurs || {}).forEach(function (k) { if (e.joueurs[k].bot) delete e.joueurs[k]; });
    var t = e.table;
    if (!t) return e;
    delete t.botAgitA;
    var avant = t.places.length;
    t.places = t.places.filter(function (p) { return e.joueurs[p.cle]; });
    if (t.tour && !e.joueurs[t.tour]) t.tour = null; // le tour passera au suivant via avancer()
    if (t.places.length === 0 && avant > 0) {
      // Plus personne : on repart sur une manche propre en phase de mises.
      t.phase = 'mises'; t.croupier = []; t.paquet = []; t.tour = null; t.echeance = null;
    }
    return e;
  }

  function charger() {
    try {
      var brut = window.localStorage.getItem(CLE_STOCKAGE);
      if (brut) return purgerFictifs(JSON.parse(brut));
    } catch (e) { /* stockage indisponible : on repart de zéro */ }
    return etatInitial();
  }

  function sauver() {
    try { window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(S)); } catch (e) { /* sans importance */ }
  }

  var S = charger();

  function erreur(code) { var e = new Error(code); e.code = code; return e; }

  function place(t, cle) {
    for (var i = 0; i < t.places.length; i++) if (t.places[i].cle === cle) return t.places[i];
    return null;
  }

  /* ---------------- Logique de table (portage de Table.gs) ---------------- */

  function asseoir(t, cle, pseudo) {
    if (place(t, cle)) throw erreur('deja_assis');
    if (t.places.length >= R.PLACES_MAX) throw erreur('table_pleine');
    t.places.push({ cle: cle, pseudo: pseudo, mise: 0, main: [], statut: 'attente', resultat: null, gain: 0, inactif: 0 });
  }

  function crediter(cle, montant) { if (S.joueurs[cle]) S.joueurs[cle].solde += montant; }

  function quitter(t, cle, now) {
    var p = place(t, cle);
    if (!p) throw erreur('pas_assis');
    if (t.phase === 'mises' && p.statut === 'mise') crediter(cle, p.mise); // mise remboursée
    var etaitSonTour = t.phase === 'jeu' && t.tour === cle;
    t.places = t.places.filter(function (x) { return x.cle !== cle; });
    if (etaitSonTour) passerAuSuivant(t, now);
  }

  function miser(t, cle, mise, now) {
    if (typeof mise !== 'number' || !Number.isInteger(mise) || mise < R.MISE_MIN || mise > R.MISE_MAX) throw erreur('mise_invalide');
    var p = place(t, cle);
    if (!p) throw erreur('pas_assis');
    if (t.phase !== 'mises') throw erreur('mises_fermees');
    if (p.statut !== 'attente') throw erreur('deja_mise');
    var j = S.joueurs[cle];
    if (j.solde < R.MISE_MIN) j.solde = R.SOLDE_INITIAL; // faillite : renfloué, comme le serveur
    if (mise > j.solde) throw erreur('solde_insuffisant');
    j.solde -= mise;
    p.mise = mise;
    p.statut = 'mise';
    if (t.echeance === null) t.echeance = now + R.DUREE_MISES_MS;
  }

  function sonTour(t, cle) {
    var p = place(t, cle);
    if (!p) throw erreur('pas_assis');
    if (t.phase !== 'jeu' || t.tour !== cle) throw erreur('pas_ton_tour');
    return p;
  }

  function tirer(t, cle, now) {
    var p = sonTour(t, cle);
    p.main.push(t.paquet.pop());
    var tot = total(p.main);
    if (tot > 21) { p.statut = 'saute'; return passerAuSuivant(t, now); }
    if (tot === 21) { p.statut = 'reste'; return passerAuSuivant(t, now); }
    t.echeance = now + R.DUREE_TOUR_MS;
  }

  function rester(t, cle, now) {
    sonTour(t, cle).statut = 'reste';
    passerAuSuivant(t, now);
  }

  function distribuer(t, now) {
    t.paquet = paquetMelange();
    t.croupier = [];
    var joueurs = t.places.filter(function (p) { return p.statut === 'mise'; });
    for (var k = 0; k < 2; k++) {
      joueurs.forEach(function (p) { p.main.push(t.paquet.pop()); });
      t.croupier.push(t.paquet.pop());
    }
    joueurs.forEach(function (p) { p.statut = estBlackjack(p.main) ? 'blackjack' : 'joue'; });
    t.phase = 'jeu';
    t.tour = null;
    if (estBlackjack(t.croupier)) return regler(t, now);
    passerAuSuivant(t, now);
  }

  function passerAuSuivant(t, now) {
    for (var i = 0; i < t.places.length; i++) {
      if (t.places[i].statut === 'joue') {
        t.tour = t.places[i].cle;
        t.echeance = now + R.DUREE_TOUR_MS;
        return;
      }
    }
    regler(t, now);
  }

  function regler(t, now) {
    var enMain = t.places.filter(function (p) { return ['joue', 'reste', 'saute', 'blackjack'].indexOf(p.statut) >= 0; });
    if (enMain.some(function (p) { return p.statut === 'reste'; })) {
      while (total(t.croupier) < 17) t.croupier.push(t.paquet.pop());
    }
    enMain.forEach(function (p) {
      p.resultat = resultat(p.main, t.croupier);
      p.gain = gain(p.resultat, p.mise);
      p.statut = 'fini';
      crediter(p.cle, p.gain);
    });
    t.phase = 'fin';
    t.tour = null;
    t.paquet = [];
    t.echeance = now + R.DUREE_FIN_MS;
  }

  function nouvelleManche(t, now) {
    t.places.forEach(function (p) { p.inactif = p.mise > 0 ? 0 : p.inactif + 1; });
    t.places = t.places.filter(function (p) { return S.joueurs[p.cle] && p.inactif < R.MANCHES_INACTIF_MAX; });
    t.places.forEach(function (p) { p.mise = 0; p.main = []; p.statut = 'attente'; p.resultat = null; p.gain = 0; });
    t.phase = 'mises';
    t.manche += 1;
    t.croupier = [];
    t.paquet = [];
    t.tour = null;
    t.echeance = null;
  }

  /** Applique tout ce qui est dû à l'instant `now` (équivalent de tbAvancer). */
  function avancer(t, now) {
    for (var garde = 0; garde < 10; garde++) {
      var misees = t.places.filter(function (p) { return p.statut === 'mise'; }).length;
      if (t.phase === 'mises' && misees > 0 && (misees === t.places.length || now >= t.echeance)) distribuer(t, now);
      else if (t.phase === 'jeu' && (t.tour === null || now >= t.echeance)) {
        var courant = t.tour && place(t, t.tour);
        if (courant) courant.statut = 'reste'; // temps écoulé
        passerAuSuivant(t, now);
      } else if (t.phase === 'fin' && now >= t.echeance) nouvelleManche(t, now);
      else return;
    }
  }

  /** Vue publique : même forme que tbVue() + reponseJoueur_(). Jamais la carte cachée. */
  function vue(cle, now) {
    var t = S.table;
    var cr = t.phase === 'jeu' ? t.croupier.slice(0, 1) : t.croupier.slice();
    var tourPlace = t.tour ? place(t, t.tour) : null;
    return {
      moi: { pseudo: S.joueurs[cle].pseudo, solde: S.joueurs[cle].solde },
      regles: { miseMin: R.MISE_MIN, miseMax: R.MISE_MAX },
      table: {
        phase: t.phase,
        manche: t.manche,
        placesMax: R.PLACES_MAX,
        secondesRestantes: t.echeance === null ? null : Math.max(0, Math.ceil((t.echeance - now) / 1000)),
        tour: tourPlace ? tourPlace.pseudo : null,
        monTour: t.phase === 'jeu' && t.tour === cle,
        assis: place(t, cle) !== null,
        croupier: { cartes: cr, carteCachee: t.phase === 'jeu', total: cr.length ? total(cr) : null },
        places: t.places.map(function (p) {
          return {
            pseudo: p.pseudo, moi: p.cle === cle, mise: p.mise, cartes: p.main.slice(),
            total: p.main.length ? total(p.main) : null, statut: p.statut, resultat: p.resultat, gain: p.gain
          };
        })
      }
    };
  }

  /* ---------------- Routage des actions (équivalent de doPost) ---------------- */

  function authentifier(jeton) {
    if (typeof jeton !== 'string' || !S.joueurs[jeton]) throw erreur('session_invalide');
    return jeton;
  }

  function jetonAleatoire() {
    var o = new Uint8Array(32);
    crypto.getRandomValues(o);
    return Array.prototype.map.call(o, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function traiter(req) {
    var now = Date.now();
    var t = S.table;
    switch (req.action) {
      case 'inscription': {
        var pseudo = req.pseudo;
        if (typeof pseudo !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(pseudo) ||
            PSEUDOS_RESERVES.indexOf(pseudo.toLowerCase()) >= 0) throw erreur('pseudo_invalide');
        var pris = Object.keys(S.joueurs).some(function (k) { return S.joueurs[k].pseudo.toLowerCase() === pseudo.toLowerCase(); });
        if (pris) throw erreur('pseudo_pris');
        var jeton = jetonAleatoire();
        S.joueurs[jeton] = { pseudo: pseudo, solde: R.SOLDE_INITIAL };
        return { jeton: jeton, pseudo: pseudo, joursValidite: R.SESSION_JOURS };
      }
      case 'classement': {
        var tous = Object.keys(S.joueurs).map(function (k) { return S.joueurs[k]; });
        return {
          top: tous.map(function (j) { return { pseudo: j.pseudo, solde: j.solde }; })
            .sort(function (a, b) { return b.solde - a.solde; }).slice(0, 10)
        };
      }
      case 'supprimerCompte': {
        var c = authentifier(req.jeton);
        if (place(t, c)) quitter(t, c, now);
        delete S.joueurs[c];
        return { supprime: true };
      }
    }
    var cle = authentifier(req.jeton);
    avancer(t, now);
    switch (req.action) {
      case 'etat': break;
      case 'asseoir': asseoir(t, cle, S.joueurs[cle].pseudo); break;
      case 'quitter': quitter(t, cle, now); break;
      case 'miser': miser(t, cle, req.mise, now); break;
      case 'tirer': tirer(t, cle, now); break;
      case 'rester': rester(t, cle, now); break;
      default: throw erreur('action_inconnue');
    }
    avancer(t, now);
    return vue(cle, now);
  }

  /* ---------------- Interception de fetch ---------------- */

  function repondre(objet) {
    return new Response(JSON.stringify(objet), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  /**
   * Remplace fetch : latence simulée, panne simulée, et respect d'un éventuel AbortController
   * (utile pour tester un délai d'attente côté app.js).
   */
  window.fetch = function (url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var signal = options.signal;
      var minuteur = setTimeout(function () {
        if (reglages.horsLigne) { reject(new TypeError('Failed to fetch')); return; }
        var req;
        try { req = JSON.parse(options.body); } catch (e) { resolve(repondre({ ok: false, erreur: 'requete_invalide', message: 'Requête invalide.' })); return; }
        try {
          var data = traiter(req);
          sauver();
          resolve(repondre({ ok: true, data: data }));
        } catch (e) {
          if (!e.code || !MESSAGES[e.code]) { reject(e); return; }
          sauver();
          resolve(repondre({ ok: false, erreur: e.code, message: MESSAGES[e.code] }));
        }
      }, reglages.latenceMs);
      if (signal) {
        signal.addEventListener('abort', function () {
          clearTimeout(minuteur);
          reject(new DOMException('Requête annulée', 'AbortError'));
        });
      }
    });
  };

  /* ---------------- Panneau de contrôle de la démo ---------------- */

  function el(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte) n.textContent = texte;
    return n;
  }

  function construirePanneau() {
    // <details> replié par défaut : le panneau ne cache pas les commandes du jeu.
    var cadre = el('details', 'demo-panneau');
    cadre.appendChild(el('summary', null, 'Mode démo'));
    var panneau = el('div', 'demo-contenu');
    cadre.appendChild(panneau);
    panneau.appendChild(el('span', 'demo-aide', 'Faux serveur local, aucune donnée envoyée.'));

    var label = el('label', null, 'Réponse du serveur ');
    var choix = el('select');
    [['300', 'rapide (0,3 s)'], ['2000', 'lente (2 s)'], ['6000', 'très lente (6 s)']].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      choix.appendChild(opt);
    });
    choix.addEventListener('change', function () { reglages.latenceMs = Number(choix.value); });
    label.appendChild(choix);
    panneau.appendChild(label);

    var labelPanne = el('label');
    var panne = el('input');
    panne.type = 'checkbox';
    panne.addEventListener('change', function () { reglages.horsLigne = panne.checked; });
    labelPanne.appendChild(panne);
    labelPanne.appendChild(document.createTextNode(' Serveur injoignable'));
    panneau.appendChild(labelPanne);

    var reset = el('button', 'demo-reset', 'Réinitialiser la démo');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      try { window.localStorage.removeItem(CLE_STOCKAGE); } catch (e) { /* rien */ }
      document.cookie = NOM_COOKIE_DEMO + '=; Max-Age=0; Path=/; Secure; SameSite=Strict';
      window.location.reload();
    });
    panneau.appendChild(reset);
    document.body.appendChild(cadre);
  }

  // Script chargé en defer : le DOM est déjà prêt.
  construirePanneau();
})();
