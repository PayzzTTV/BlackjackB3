/*
 * Blackjack B3 : client.
 * Règles de sécurité de ce fichier :
 *  - jamais innerHTML / outerHTML / insertAdjacentHTML / eval : uniquement textContent et createElement ;
 *  - le client n'a aucune autorité : il affiche ce que renvoie le serveur et transmet des intentions.
 */
(function () {
  'use strict';

  // Anti-clickjacking (frame-ancestors est impossible via <meta>) : on refuse de tourner dans un cadre.
  if (window.top !== window.self) {
    document.body.textContent = 'Cette page ne peut pas être affichée dans un cadre.';
    return;
  }

  var CONFIG = window.BJ_CONFIG || {};
  // Nom du cookie de session. La démo (demo.js) en impose un autre : sur la même origine,
  // elle effacerait ou écraserait sinon le vrai cookie, et le joueur perdrait son compte.
  // Liste blanche stricte : seul un nom __Host-bj_<lettres> est accepté.
  var NOM_COOKIE = /^__Host-bj_[a-z]{3,20}$/.test(CONFIG.NOM_COOKIE || '') ? CONFIG.NOM_COOKIE : '__Host-bj_session';
  var SYMBOLES = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var RANGS_FR = { J: 'V', Q: 'D', K: 'R' };
  var LIBELLES_STATUT = {
    attente: 'En attente', mise: 'A misé', joue: 'Joue…', reste: 'Reste', saute: 'Sauté !', blackjack: 'Blackjack !'
  };

  var $ = function (id) { return document.getElementById(id); };
  var etat = { jeton: null, vue: null, echeance: null, requeteEnCours: false, minuteur: null };

  /* ---------------- Cookie de session ----------------
   * Préfixe __Host- : le navigateur impose Secure, Path=/ et l'absence de Domain
   * (aucun sous-domaine ne peut l'écraser). SameSite=Strict : jamais envoyé depuis un autre site.
   * Il n'est pas HttpOnly : aucun serveur ne le pose (GitHub Pages est statique). La protection
   * contre son vol repose sur la CSP et l'absence totale d'injection HTML. */
  function lireCookie() {
    var morceaux = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < morceaux.length; i++) {
      var pos = morceaux[i].indexOf('=');
      if (morceaux[i].slice(0, pos) === NOM_COOKIE) {
        var valeur = morceaux[i].slice(pos + 1);
        return /^[0-9a-f]{64}$/.test(valeur) ? valeur : null;
      }
    }
    return null;
  }

  function ecrireCookie(jeton, jours) {
    document.cookie = NOM_COOKIE + '=' + jeton + '; Max-Age=' + (jours * 86400) + '; Path=/; Secure; SameSite=Strict';
  }

  function effacerCookie() {
    document.cookie = NOM_COOKIE + '=; Max-Age=0; Path=/; Secure; SameSite=Strict';
  }

  /* ---------------- Appels API ---------------- */

  function api(action, donnees) {
    var corps = { action: action };
    if (etat.jeton) corps.jeton = etat.jeton;
    Object.keys(donnees || {}).forEach(function (k) { corps[k] = donnees[k]; });
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      // text/plain : requête « simple » sans pré-vol CORS (Apps Script ne gère pas OPTIONS).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corps),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('reseau');
        return r.json();
      })
      .then(function (rep) {
        if (rep && rep.ok) return rep.data;
        var err = new Error((rep && rep.message) || 'Erreur.');
        err.code = rep && rep.erreur;
        throw err;
      }, function (err) {
        if (err && err.code) throw err;
        var e = new Error('Connexion au serveur impossible.');
        e.code = 'reseau';
        throw e;
      });
  }

  function gererErreur(err) {
    if (err.code === 'session_invalide') {
      deconnecterLocalement();
    }
    afficherMessage(err.message, true);
  }

  /* ---------------- Affichage ---------------- */

  function afficherMessage(texte, erreur) {
    var m = $('message');
    m.textContent = texte || '';
    m.hidden = !texte;
    m.classList.toggle('erreur', !!erreur);
  }

  function el(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte !== undefined && texte !== null) n.textContent = String(texte);
    return n;
  }

  function vider(noeud) {
    while (noeud.firstChild) noeud.removeChild(noeud.firstChild);
  }

  function elementCarte(carte) {
    if (carte === null) return el('div', 'carte dos', '');
    var rang = carte.slice(0, -1);
    var couleur = carte.slice(-1);
    var n = el('div', 'carte' + (couleur === 'H' || couleur === 'D' ? ' rouge' : ''));
    n.appendChild(el('span', 'rang', RANGS_FR[rang] || rang));
    n.appendChild(el('span', 'couleur', SYMBOLES[couleur] || '?'));
    n.setAttribute('aria-label', (RANGS_FR[rang] || rang) + ' ' + (SYMBOLES[couleur] || ''));
    return n;
  }

  function libelleResultat(p) {
    var net = p.gain - p.mise;
    switch (p.resultat) {
      case 'blackjack': return 'Blackjack ! +' + net;
      case 'gagne': return 'Gagné +' + net;
      case 'egalite': return 'Égalité (remboursé)';
      case 'perdu': return 'Perdu −' + p.mise;
      default: return '';
    }
  }

  function afficherJeu(data) {
    etat.vue = data;
    var t = data.table;

    $('profil').hidden = false;
    $('profil-pseudo').textContent = data.moi.pseudo;
    $('profil-solde').textContent = String(data.moi.solde);
    $('ecran-inscription').hidden = true;
    $('ecran-jeu').hidden = false;

    // Croupier
    var zoneCroupier = $('croupier-cartes');
    vider(zoneCroupier);
    t.croupier.cartes.forEach(function (c) { zoneCroupier.appendChild(elementCarte(c)); });
    if (t.croupier.carteCachee) zoneCroupier.appendChild(elementCarte(null));
    $('croupier-total').textContent = t.croupier.total === null ? '' : '(' + t.croupier.total + (t.croupier.carteCachee ? ' + ?' : '') + ')';

    // Places
    var liste = $('places');
    vider(liste);
    for (var i = 0; i < t.placesMax; i++) {
      var p = t.places[i];
      var li = el('li', 'place');
      if (!p) {
        li.classList.add('libre');
        li.appendChild(el('span', 'pseudo', 'Place libre'));
        liste.appendChild(li);
        continue;
      }
      if (p.moi) li.classList.add('moi');
      if (t.tour === p.pseudo) li.classList.add('actif');
      var tete = el('div', 'tete');
      tete.appendChild(el('span', 'pseudo', p.pseudo + (p.moi ? ' (vous)' : '')));
      if (p.mise > 0) tete.appendChild(el('span', 'jetons', p.mise + ' j.'));
      li.appendChild(tete);
      var main = el('div', 'main');
      p.cartes.forEach(function (c) { main.appendChild(elementCarte(c)); });
      li.appendChild(main);
      var bas = p.statut === 'fini' ? libelleResultat(p) : (LIBELLES_STATUT[p.statut] || '');
      if (p.total !== null) bas = p.total + ' · ' + bas;
      li.appendChild(el('div', 'statut ' + (p.resultat || p.statut), bas));
      liste.appendChild(li);
    }

    // Commandes
    var moi = t.places.filter(function (x) { return x.moi; })[0];
    $('btn-asseoir').hidden = t.assis;
    $('btn-asseoir').disabled = t.places.length >= t.placesMax;
    $('btn-quitter').hidden = !t.assis;
    $('form-mise').hidden = !(t.assis && t.phase === 'mises' && moi && moi.statut === 'attente');
    $('btn-tirer').hidden = !t.monTour;
    $('btn-rester').hidden = !t.monTour;
    var champ = $('champ-mise');
    champ.min = String(data.regles.miseMin);
    champ.max = String(data.regles.miseMax);

    etat.echeance = t.secondesRestantes === null ? null : Date.now() + t.secondesRestantes * 1000;
    rafraichirAnnonce();
  }

  function rafraichirAnnonce() {
    var t = etat.vue && etat.vue.table;
    if (!t) return;
    var reste = etat.echeance === null ? null : Math.max(0, Math.ceil((etat.echeance - Date.now()) / 1000));
    var txt;
    if (t.phase === 'mises') {
      txt = t.places.length === 0 ? 'Table vide : asseyez-vous pour lancer une manche.'
        : reste === null ? 'Faites vos jeux !' : 'Faites vos jeux : distribution dans ' + reste + ' s';
    } else if (t.phase === 'jeu') {
      txt = t.monTour ? 'À vous de jouer ! (' + reste + ' s)' : 'Au tour de ' + t.tour + ' (' + reste + ' s)';
    } else {
      txt = 'Fin de la manche ' + t.manche + (reste !== null ? ' : nouvelle manche dans ' + reste + ' s' : '');
    }
    $('annonce').textContent = txt;
  }

  function afficherClassement(data) {
    var ol = $('classement');
    vider(ol);
    data.top.forEach(function (j) {
      var li = el('li');
      li.appendChild(el('span', 'pseudo', j.pseudo));
      li.appendChild(el('span', 'jetons', j.solde));
      ol.appendChild(li);
    });
  }

  /* ---------------- Cycle de vie ---------------- */

  function afficherInscription() {
    $('profil').hidden = true;
    $('ecran-jeu').hidden = true;
    $('ecran-inscription').hidden = false;
  }

  function deconnecterLocalement() {
    etat.jeton = null;
    etat.vue = null;
    effacerCookie();
    arreterSondage();
    afficherInscription();
  }

  function sonder() {
    if (!etat.jeton || etat.requeteEnCours || document.hidden) return planifier();
    etat.requeteEnCours = true;
    api('etat')
      .then(afficherJeu, gererErreur)
      .then(function () { etat.requeteEnCours = false; planifier(); });
  }

  function planifier() {
    clearTimeout(etat.minuteur);
    if (etat.jeton) etat.minuteur = setTimeout(sonder, CONFIG.INTERVALLE_MS || 2500);
  }

  function arreterSondage() {
    clearTimeout(etat.minuteur);
    etat.minuteur = null;
  }

  function chargerClassement() {
    api('classement').then(afficherClassement, function () { /* non bloquant */ });
  }

  /** Action de jeu : boutons désactivés pendant l'appel (pas de double clic). */
  function agir(action, donnees) {
    var boutons = document.querySelectorAll('.commandes button');
    boutons.forEach(function (b) { b.disabled = true; });
    afficherMessage('');
    return api(action, donnees)
      .then(afficherJeu, gererErreur)
      .then(function () { boutons.forEach(function (b) { b.disabled = false; }); if (etat.vue) afficherJeu(etat.vue); });
  }

  function demarrer() {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('REMPLACER') >= 0) {
      afficherMessage('Configuration manquante : renseignez API_URL dans config.js.', true);
      return;
    }
    etat.jeton = lireCookie();
    chargerClassement();
    setInterval(chargerClassement, 30000);
    setInterval(rafraichirAnnonce, 500);
    if (etat.jeton) {
      ecrireCookie(etat.jeton, 30); // prolonge le cookie à chaque visite
      sonder();
    } else {
      afficherInscription();
    }
  }

  /* ---------------- Événements ---------------- */

  $('form-inscription').addEventListener('submit', function (e) {
    e.preventDefault();
    var pseudo = $('champ-pseudo').value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo)) {
      afficherMessage('Pseudo invalide : 3 à 16 caractères (lettres, chiffres, _).', true);
      return;
    }
    afficherMessage('');
    api('inscription', { pseudo: pseudo }).then(function (data) {
      etat.jeton = data.jeton;
      ecrireCookie(data.jeton, data.joursValidite);
      $('champ-pseudo').value = '';
      sonder();
    }, gererErreur);
  });

  $('form-mise').addEventListener('submit', function (e) {
    e.preventDefault();
    var mise = Number($('champ-mise').value);
    if (!Number.isInteger(mise)) {
      afficherMessage('Mise invalide.', true);
      return;
    }
    agir('miser', { mise: mise });
  });

  $('btn-asseoir').addEventListener('click', function () { agir('asseoir'); });
  $('btn-quitter').addEventListener('click', function () {
    var t = etat.vue && etat.vue.table;
    if (t && t.phase === 'jeu' && !window.confirm('Quitter maintenant abandonne votre main (mise perdue). Continuer ?')) return;
    agir('quitter');
  });
  $('btn-tirer').addEventListener('click', function () { agir('tirer'); });
  $('btn-rester').addEventListener('click', function () { agir('rester'); });

  $('btn-supprimer').addEventListener('click', function () {
    if (!window.confirm('Sans mot de passe, quitter = supprimer définitivement votre compte et vos jetons. Continuer ?')) return;
    api('supprimerCompte').then(function () {
      deconnecterLocalement();
      afficherMessage('Compte supprimé.');
      chargerClassement();
    }, gererErreur);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && etat.jeton) sonder();
  });

  demarrer();
})();
