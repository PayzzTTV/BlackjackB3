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
  var NOM_COOKIE = '__Host-bj_session';
  var SYMBOLES = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var RANGS_FR = { J: 'V', Q: 'D', K: 'R' };
  // Noms complets, pour les lecteurs d'écran (« Dame de cœur » plutôt que « D ♥ »).
  var NOMS_RANGS = { A: 'As', J: 'Valet', Q: 'Dame', K: 'Roi' };
  var NOMS_COULEURS = { S: 'pique', H: 'cœur', D: 'carreau', C: 'trèfle' };
  var LIBELLES_STATUT = {
    attente: 'En attente', mise: 'A misé', joue: 'Joue…', reste: 'Reste', saute: 'Sauté !', blackjack: 'Blackjack !'
  };

  // États de chargement : Apps Script met 1 à 3 s à répondre au premier appel (démarrage à froid).
  var SEUIL_LENT_MS = 1500;   // au-delà, on prévient que le serveur est lent
  var DELAI_MAX_MS = 15000;   // au-delà, on abandonne la requête (AbortController)

  var $ = function (id) { return document.getElementById(id); };
  var etat = {
    jeton: null, vue: null, echeance: null, requeteEnCours: false, minuteur: null,
    // Connexion : nombre de requêtes lentes en cours, et dernier sondage échoué (serveur injoignable).
    lentes: 0, horsLigne: false, messageConnexion: false,
    // Numérotation des requêtes qui renvoient une vue de la table (voir demanderVue).
    numeroEmis: 0, numeroAffiche: 0,
    // Nombre de cartes déjà affichées par main, pour n'animer que les nouvelles (voir marquerNouvelles).
    cartesVues: { manche: null, mains: {} },
    // Durée totale du décompte en cours, pour dessiner la barre (le serveur ne donne que le restant).
    decompte: { cle: null, total: null }
  };

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

  /**
   * Appelle l'API et renvoie une promesse de `data`.
   * En cas d'échec, l'erreur porte un `code` :
   *  - code du serveur (ex. 'pas_ton_tour'), avec son message ;
   *  - 'reseau' : serveur injoignable (hors ligne, DNS, CORS...) ;
   *  - 'delai'  : pas de réponse après DELAI_MAX_MS, la requête est annulée.
   * Toute requête qui dépasse SEUIL_LENT_MS allume l'indicateur « serveur lent ».
   */
  function api(action, donnees) {
    var corps = { action: action };
    if (etat.jeton) corps.jeton = etat.jeton;
    Object.keys(donnees || {}).forEach(function (k) { corps[k] = donnees[k]; });

    var controleur = new AbortController();
    var annulee = false;
    var estLente = false;
    var minuteurLent = setTimeout(function () { estLente = true; etat.lentes++; majConnexion(); }, SEUIL_LENT_MS);
    var minuteurMax = setTimeout(function () { annulee = true; controleur.abort(); }, DELAI_MAX_MS);
    function terminer() {
      clearTimeout(minuteurLent);
      clearTimeout(minuteurMax);
      if (estLente) { etat.lentes--; majConnexion(); }
    }

    var promesse = fetch(CONFIG.API_URL, {
      method: 'POST',
      // text/plain : requête « simple » sans pré-vol CORS (Apps Script ne gère pas OPTIONS).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corps),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controleur.signal
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
        var e = annulee
          ? new Error('Le serveur ne répond pas (plus de ' + (DELAI_MAX_MS / 1000) + ' s). Réessayez dans un instant.')
          : new Error('Serveur injoignable. Vérifiez votre connexion internet.');
        e.code = annulee ? 'delai' : 'reseau';
        throw e;
      });
    promesse.then(terminer, terminer);
    return promesse;
  }

  /**
   * Comme api(), pour les actions qui renvoient une vue de la table (etat, asseoir, miser...).
   *
   * Problème corrigé (« course sondage / action ») : un sondage parti AVANT un clic sur « Tirer »
   * peut revenir APRÈS la réponse de « Tirer ». Sans précaution, cette vieille vue écrasait
   * l'affichage et la nouvelle carte disparaissait jusqu'au sondage suivant.
   *
   * Solution : chaque requête reçoit un numéro croissant au départ. Une réponse plus ancienne que
   * la dernière vue affichée est périmée : la promesse renvoie alors null et rien n'est affiché.
   * @return {Promise<Object|null>} la vue, ou null si elle est périmée
   */
  function demanderVue(action, donnees) {
    var numero = ++etat.numeroEmis;
    return api(action, donnees).then(function (data) {
      if (numero < etat.numeroAffiche) return null; // une réponse plus récente est déjà affichée
      etat.numeroAffiche = numero;
      return data;
    });
  }

  /** Vrai si l'erreur vient du transport (réseau, délai) et pas d'un refus du serveur. */
  function estErreurConnexion(err) {
    return err && (err.code === 'reseau' || err.code === 'delai');
  }

  /** Appelé à chaque réponse réussie : masque le bandeau et l'éventuel message d'erreur réseau. */
  function connexionRetablie() {
    if (etat.messageConnexion) { afficherMessage(''); etat.messageConnexion = false; }
    if (etat.horsLigne) { etat.horsLigne = false; majConnexion(); }
  }

  /** Affiche ou masque le bandeau d'état de la connexion (lent / injoignable). */
  function majConnexion() {
    var n = $('connexion');
    var texte = etat.horsLigne ? 'Connexion perdue : nouvel essai automatique toutes les quelques secondes.'
      : etat.lentes > 0 ? 'Le serveur répond lentement, patientez…' : '';
    n.textContent = texte;
    n.hidden = !texte;
    n.classList.toggle('hors-ligne', etat.horsLigne);
  }

  /**
   * Marque un bouton « en cours » (indicateur animé + aria-busy) et renvoie la fonction qui le libère.
   * Le bouton est désactivé pour empêcher un double envoi.
   */
  function occuper(bouton) {
    if (!bouton) return function () {};
    bouton.disabled = true;
    bouton.classList.add('en-cours');
    bouton.setAttribute('aria-busy', 'true');
    return function liberer() {
      bouton.disabled = false;
      bouton.classList.remove('en-cours');
      bouton.removeAttribute('aria-busy');
    };
  }

  function gererErreur(err) {
    // Retenu pour effacer ce message tout seul quand la connexion revient (voir connexionRetablie).
    etat.messageConnexion = estErreurConnexion(err);
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

  /**
   * Construit une carte. `carte` vaut "<rang><couleur>" (ex. "QH"), ou null pour une carte face cachée.
   * Structure : index en coin (rang + petit symbole) et grand symbole, tous en textContent.
   * Le dessin est masqué aux lecteurs d'écran (aria-hidden), qui lisent le nom complet via role="img".
   */
  function elementCarte(carte) {
    var n;
    if (carte === null) {
      n = el('div', 'carte dos');
      n.setAttribute('role', 'img');
      n.setAttribute('aria-label', 'Carte cachée');
      return n;
    }
    var rang = carte.slice(0, -1);
    var couleur = carte.slice(-1);
    var symbole = SYMBOLES[couleur] || '?';
    n = el('div', 'carte' + (couleur === 'H' || couleur === 'D' ? ' rouge' : ''));
    [el('span', 'rang', RANGS_FR[rang] || rang), el('span', 'couleur-coin', symbole), el('span', 'couleur', symbole)]
      .forEach(function (morceau) { morceau.setAttribute('aria-hidden', 'true'); n.appendChild(morceau); });
    n.setAttribute('role', 'img');
    n.setAttribute('aria-label', (NOMS_RANGS[rang] || rang) + ' de ' + (NOMS_COULEURS[couleur] || ''));
    return n;
  }

  /**
   * Ajoute la classe .distribuee aux cartes apparues depuis le dernier affichage, pour que
   * seules elles soient animées (l'affichage est entièrement reconstruit à chaque sondage).
   * @param {string} cle identifiant de la main (« croupier » ou le pseudo du joueur)
   * @param {HTMLElement} conteneur la zone .main qui vient d'être remplie
   */
  function marquerNouvelles(cle, conteneur) {
    var cartes = conteneur.children;
    var deja = etat.cartesVues.mains[cle] || 0;
    for (var i = deja; i < cartes.length; i++) {
      cartes[i].classList.add('distribuee');
      // Petit décalage entre les cartes d'une même distribution (CSSOM : autorisé par la CSP).
      cartes[i].style.animationDelay = ((i - deja) * 90) + 'ms';
    }
    etat.cartesVues.mains[cle] = cartes.length;
  }

  /** Couleur du jeton de mise selon le montant (convention de casino, voir style.css). */
  function classeJeton(mise) {
    if (mise >= 500) return 'j500';
    if (mise >= 100) return 'j100';
    if (mise >= 50) return '';
    return 'j10';
  }

  /** Texte et classe du badge de résultat affiché en fin de manche. */
  function libelleResultat(p) {
    var net = p.gain - p.mise;
    switch (p.resultat) {
      case 'blackjack': return 'Blackjack ! +' + net;
      case 'gagne': return 'Gagné +' + net;
      case 'egalite': return 'Égalité, remboursé';
      case 'perdu': return 'Perdu −' + p.mise;
      default: return '';
    }
  }

  /** Construit la case d'un joueur assis (ou d'une place libre si `p` est absent). */
  function elementPlace(p, t) {
    var li = el('li', 'place');
    if (!p) {
      li.classList.add('libre');
      li.appendChild(el('span', null, 'Place libre'));
      return li;
    }
    if (p.moi) li.classList.add('moi');
    if (t.tour === p.pseudo) li.classList.add('actif');

    var tete = el('div', 'tete');
    var nom = el('span', 'pseudo', p.pseudo);
    if (p.moi) nom.appendChild(el('span', 'vous', ' (vous)'));
    tete.appendChild(nom);
    if (p.mise > 0) {
      var jeton = el('span', ('mise-jeton ' + classeJeton(p.mise)).trim(), p.mise);
      jeton.setAttribute('aria-label', 'Mise : ' + p.mise + ' jetons');
      tete.appendChild(jeton);
    }
    li.appendChild(tete);

    var main = el('div', 'main');
    p.cartes.forEach(function (c) { main.appendChild(elementCarte(c)); });
    li.appendChild(main);
    marquerNouvelles(p.pseudo, main);

    var statut = el('div', 'statut');
    if (p.total !== null) statut.appendChild(el('span', 'main-total', p.total + ' '));
    if (p.statut === 'fini') {
      statut.appendChild(el('span', 'resultat ' + p.resultat, libelleResultat(p)));
    } else {
      var libelle = LIBELLES_STATUT[p.statut] || '';
      statut.appendChild(p.statut === 'saute' || p.statut === 'blackjack'
        ? el('span', 'resultat ' + p.statut, libelle)
        : document.createTextNode(libelle));
    }
    li.appendChild(statut);
    return li;
  }

  /**
   * Affiche la vue renvoyée par le serveur (réponse de « etat » ou d'une action).
   * Le DOM de la table est reconstruit à chaque appel : le serveur fait foi, le client ne garde
   * que des détails d'affichage (cartes déjà animées, durée du décompte).
   * @param {{moi: Object, regles: Object, table: Object}} data
   */
  function afficherJeu(data) {
    var phaseAvant = etat.vue && etat.vue !== data ? etat.vue.table.phase : null;
    etat.vue = data;
    var t = data.table;

    $('profil').hidden = false;
    $('profil-pseudo').textContent = data.moi.pseudo;
    $('profil-solde').textContent = String(data.moi.solde);
    $('ecran-inscription').hidden = true;
    $('ecran-chargement').hidden = true;
    $('ecran-jeu').hidden = false;

    // Fin de manche : les soldes ont changé, on rafraîchit le classement tout de suite.
    if (t.phase === 'fin' && phaseAvant !== null && phaseAvant !== 'fin') chargerClassement();

    // Nouvelle manche : toutes les mains repartent de zéro carte.
    if (etat.cartesVues.manche !== t.manche) etat.cartesVues = { manche: t.manche, mains: {} };

    // Croupier (la carte cachée est un dos, jamais une vraie carte : le serveur ne l'envoie pas)
    var zoneCroupier = $('croupier-cartes');
    vider(zoneCroupier);
    t.croupier.cartes.forEach(function (c) { zoneCroupier.appendChild(elementCarte(c)); });
    if (t.croupier.carteCachee) zoneCroupier.appendChild(elementCarte(null));
    // La carte cachée ne compte pas comme « nouvelle » quand elle est retournée : on suit les vraies cartes.
    marquerNouvelles('croupier', zoneCroupier);
    if (t.croupier.carteCachee) etat.cartesVues.mains.croupier = t.croupier.cartes.length;
    $('croupier-total').textContent = t.croupier.total === null ? '' : t.croupier.total + (t.croupier.carteCachee ? ' + ?' : '');

    // Places (toujours placesMax cases, les vides affichent « Place libre »)
    var liste = $('places');
    vider(liste);
    for (var i = 0; i < t.placesMax; i++) liste.appendChild(elementPlace(t.places[i], t));

    // Commandes
    var moi = t.places.filter(function (x) { return x.moi; })[0];
    $('btn-asseoir').hidden = t.assis;
    $('btn-asseoir').disabled = t.places.length >= t.placesMax;
    $('btn-quitter').hidden = !t.assis;
    $('form-mise').hidden = !(t.assis && t.phase === 'mises' && moi && moi.statut === 'attente');
    $('btn-tirer').hidden = !t.monTour;
    $('btn-rester').hidden = !t.monTour;
    $('btn-tirer').parentNode.hidden = !t.monTour; // le groupe .decision entier
    var champ = $('champ-mise');
    champ.min = String(data.regles.miseMin);
    champ.max = String(data.regles.miseMax);
    majJetonsMise();

    etat.echeance = t.secondesRestantes === null ? null : Date.now() + t.secondesRestantes * 1000;
    // La durée totale d'un décompte = la plus grande valeur vue pour cette étape (phase, manche, joueur).
    var cleDecompte = t.phase + '|' + t.manche + '|' + t.tour;
    if (etat.decompte.cle !== cleDecompte) etat.decompte = { cle: cleDecompte, total: null };
    if (t.secondesRestantes !== null) etat.decompte.total = Math.max(etat.decompte.total || 0, t.secondesRestantes);
    rafraichirAnnonce();
  }

  /** Met à jour la barre de compte à rebours sous l'annonce (appelé toutes les 500 ms). */
  function majCompteARebours(reste) {
    var cadre = $('compte-a-rebours');
    var total = etat.decompte.total;
    cadre.hidden = reste === null || !total;
    if (cadre.hidden) return;
    var part = Math.max(0, Math.min(1, reste / total));
    // Écriture via CSSOM (style.width) : autorisée par la CSP, contrairement à un attribut style.
    $('compte-a-rebours-barre').style.width = (part * 100) + '%';
    cadre.classList.toggle('urgent', reste <= 5 && etat.vue.table.monTour);
  }

  function rafraichirAnnonce() {
    var t = etat.vue && etat.vue.table;
    if (!t) return;
    var reste = etat.echeance === null ? null : Math.max(0, Math.ceil((etat.echeance - Date.now()) / 1000));
    majCompteARebours(reste);
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
    var monPseudo = etat.vue && etat.vue.moi.pseudo;
    data.top.forEach(function (j) {
      var li = el('li', j.pseudo === monPseudo ? 'moi' : null);
      li.appendChild(el('span', 'pseudo', j.pseudo));
      li.appendChild(el('span', 'jetons', j.solde));
      ol.appendChild(li);
    });
  }

  /* ---------------- Cycle de vie ---------------- */

  function afficherInscription() {
    $('profil').hidden = true;
    $('ecran-chargement').hidden = true;
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
    demanderVue('etat')
      .then(function (data) {
        connexionRetablie();
        if (data) afficherJeu(data);
      }, function (err) {
        if (!estErreurConnexion(err)) return gererErreur(err);
        // Panne réseau pendant le sondage : bandeau discret, le sondage continue tout seul.
        etat.horsLigne = true;
        majConnexion();
        // Tout premier chargement sans réponse : on explique au lieu de laisser un écran vide.
        if (!etat.vue) $('chargement-texte').textContent = err.message + ' Nouvel essai en cours…';
      })
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

  /**
   * Action de jeu : toutes les commandes sont désactivées pendant l'appel (pas de double clic)
   * et le bouton cliqué affiche un indicateur, pour qu'aucun clic ne paraisse « mort ».
   * @param {string} action nom de l'action côté serveur
   * @param {Object} [donnees] paramètres (ex. { mise: 50 })
   * @param {HTMLElement} [bouton] bouton à l'origine de l'action
   */
  function agir(action, donnees, bouton) {
    var boutons = document.querySelectorAll('.commandes button');
    boutons.forEach(function (b) { b.disabled = true; });
    var liberer = occuper(bouton);
    afficherMessage('');
    return demanderVue(action, donnees)
      .then(function (data) {
        connexionRetablie();
        if (data) afficherJeu(data);
      }, gererErreur)
      .then(function () {
        liberer();
        boutons.forEach(function (b) { b.disabled = false; });
        if (etat.vue) afficherJeu(etat.vue); // réapplique les états hidden/disabled de la vue courante
      });
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
      $('ecran-chargement').hidden = false; // jusqu'à la première réponse du serveur
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
    var liberer = occuper(e.submitter || $('form-inscription').querySelector('button[type="submit"]'));
    api('inscription', { pseudo: pseudo }).then(function (data) {
      etat.jeton = data.jeton;
      ecrireCookie(data.jeton, data.joursValidite);
      $('champ-pseudo').value = '';
      // Compte créé : écran d'attente jusqu'à la première vue de la table.
      $('ecran-inscription').hidden = true;
      $('chargement-texte').textContent = 'Compte créé. Installation à la table…';
      $('ecran-chargement').hidden = false;
      sonder();
    }, gererErreur).then(liberer);
  });

  $('form-mise').addEventListener('submit', function (e) {
    e.preventDefault();
    var mise = Number($('champ-mise').value);
    if (!Number.isInteger(mise)) {
      afficherMessage('Mise invalide.', true);
      return;
    }
    agir('miser', { mise: mise }, e.submitter || this.querySelector('button[type="submit"]'));
  });

  /* Jetons de mise : chaque clic ajoute la valeur du jeton à la mise, sans dépasser le maximum
   * ni le solde. C'est seulement une aide à la saisie : le serveur revalide toujours la mise. */

  /** Plafond de mise affiché : le plus petit entre la règle du serveur et le solde du joueur. */
  function plafondMise() {
    var v = etat.vue;
    if (!v) return Infinity;
    // Solde sous le minimum : le serveur renfloue le joueur, on ne bloque donc que sur la règle.
    return v.moi.solde < v.regles.miseMin ? v.regles.miseMax : Math.min(v.regles.miseMax, v.moi.solde);
  }

  /** Désactive les jetons qui feraient dépasser le plafond. */
  function majJetonsMise() {
    var actuelle = Number($('champ-mise').value) || 0;
    document.querySelectorAll('.jeton-bouton').forEach(function (b) {
      b.disabled = actuelle + Number(b.dataset.valeur) > plafondMise();
    });
  }

  document.querySelectorAll('.jeton-bouton').forEach(function (b) {
    b.addEventListener('click', function () {
      var champ = $('champ-mise');
      champ.value = String((Number(champ.value) || 0) + Number(b.dataset.valeur));
      majJetonsMise();
    });
  });
  $('btn-mise-effacer').addEventListener('click', function () {
    $('champ-mise').value = '';
    majJetonsMise();
    $('champ-mise').focus();
  });
  $('champ-mise').addEventListener('input', majJetonsMise);

  $('btn-asseoir').addEventListener('click', function () { agir('asseoir', null, this); });
  $('btn-quitter').addEventListener('click', function () {
    var t = etat.vue && etat.vue.table;
    if (t && t.phase === 'jeu' && !window.confirm('Quitter maintenant abandonne votre main (mise perdue). Continuer ?')) return;
    agir('quitter', null, this);
  });
  $('btn-tirer').addEventListener('click', function () { agir('tirer', null, this); });
  $('btn-rester').addEventListener('click', function () { agir('rester', null, this); });

  $('btn-supprimer').addEventListener('click', function () {
    if (!window.confirm('Sans mot de passe, quitter = supprimer définitivement votre compte et vos jetons. Continuer ?')) return;
    var liberer = occuper(this);
    api('supprimerCompte').then(function () {
      deconnecterLocalement();
      afficherMessage('Compte supprimé.');
      chargerClassement();
    }, gererErreur).then(liberer);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && etat.jeton) sonder();
  });

  demarrer();
})();
