'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./faux-apps-script');

function inscrire(appel, pseudo) {
  const r = appel({ action: 'inscription', pseudo });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.jeton;
}

/** Tout le contenu du Sheet, sérialisé (pour chercher des fuites). */
const dumpSheet = (services) =>
  JSON.stringify([...services.feuilles.values()].map((f) => f.lignes));

test('inscription : jeton de 256 bits hexadécimal, seule son empreinte est stockée', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  assert.match(jeton, /^[0-9a-f]{64}$/);
  assert.ok(!dumpSheet(services).includes(jeton), 'jeton en clair dans le Sheet');
  const ligne = services.feuilles.get('Joueurs').lignes[1];
  assert.equal(ligne[0], 'Alice');
  assert.equal(ligne[4], 1000);
});

test('inscription : pseudo unique, insensible à la casse ; pseudos réservés', () => {
  const { appel } = backend();
  inscrire(appel, 'Alice');
  assert.equal(appel({ action: 'inscription', pseudo: 'alice' }).erreur, 'pseudo_pris');
  assert.equal(appel({ action: 'inscription', pseudo: 'Croupier' }).erreur, 'pseudo_pris');
});

test('inscription : pseudos malveillants ou invalides refusés', () => {
  const { appel } = backend();
  const mauvais = [
    '=IMPORTXML("http://x","//a")', '+cmd', '@SUM(A1)', '<img src=x onerror=alert(1)>',
    'ab', 'a'.repeat(17), 'é_accent', 'a b', '', null, 42, ['Alice'], { a: 1 }
  ];
  mauvais.forEach((p) => {
    assert.equal(appel({ action: 'inscription', pseudo: p }).erreur, 'pseudo_invalide', String(p));
  });
});

test('requêtes malformées rejetées sans détail technique', () => {
  const { appel, ctx } = backend();
  assert.equal(appel('pas du json').erreur, 'requete_invalide');
  assert.equal(appel('[]').erreur, 'requete_invalide');
  assert.equal(appel('null').erreur, 'requete_invalide');
  assert.equal(appel({ pseudo: 'x' }).erreur, 'requete_invalide');
  assert.equal(appel({ action: 'x'.repeat(2000) }).erreur, 'requete_invalide');
  for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'initialiser', 'reinitialiserTable', 'viderCacheJoueurs']) {
    assert.equal(appel({ action: a }).erreur, 'action_inconnue', a);
  }
  assert.equal(JSON.parse(ctx.doPost({}).contenu).erreur, 'requete_invalide');
  assert.equal(JSON.parse(ctx.doGet().contenu).ok, false);
});

test('erreur interne : message générique, aucune trace', () => {
  const { appel, ctx } = backend();
  const jeton = inscrire(appel, 'Alice');
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('secret interne /chemin'); } };
  const r = appel({ action: 'asseoir', jeton }); // etat ne lit plus le Sheet (fiche en cache)
  assert.equal(r.erreur, 'erreur_serveur');
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('sessions : jeton absent, malformé, inconnu ou expiré refusé', () => {
  const { appel, services, ctx } = backend();
  const jeton = inscrire(appel, 'Alice');
  for (const j of [undefined, '', 'abc', jeton.toUpperCase(), jeton + '0', 'f'.repeat(64), 123, { $ne: null }]) {
    assert.equal(appel({ action: 'etat', jeton: j }).erreur, 'session_invalide', String(j));
  }
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
  services.feuilles.get('Joueurs').lignes[1][3] = Date.now() - 1; // expiration (à la main)
  ctx.viderCacheJoueurs(); // procédure documentée après une modification manuelle du Sheet
  assert.equal(appel({ action: 'etat', jeton }).erreur, 'session_invalide');
});

test('sessions : une fiche en cache expirée est refusée aussi', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  const cle = [...services.cache.keys()].find((k) => k.startsWith('j:'));
  const fiche = JSON.parse(services.cache.get(cle));
  fiche.jeton_expire = Date.now() - 1;
  services.cache.set(cle, JSON.stringify(fiche));
  assert.equal(appel({ action: 'etat', jeton }).erreur, 'session_invalide');
});

test('mises : types et bornes vérifiés côté serveur', () => {
  const { appel } = backend();
  const jeton = inscrire(appel, 'Alice');
  appel({ action: 'asseoir', jeton });
  for (const m of [-50, 0, 9, 501, 10.5, '50', null, [50], 1e9, NaN, Infinity]) {
    assert.equal(appel({ action: 'miser', jeton, mise: m }).erreur, 'mise_invalide', String(m));
  }
  assert.equal(appel({ action: 'etat', jeton }).data.moi.solde, 1000);
});

test('partie complète : solde débité puis crédité correctement, carte cachée jamais envoyée', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  assert.equal(appel({ action: 'asseoir', jeton }).data.table.assis, true);

  let r = appel({ action: 'miser', jeton, mise: 100 });
  assert.equal(r.ok, true, JSON.stringify(r));
  let t = r.data.table;

  if (t.phase === 'jeu') {
    const table = JSON.parse(services.proprietes.get('TABLE'));
    const cachee = table.croupier[1];
    assert.equal(t.croupier.cartes.length, 1);
    assert.ok(!JSON.stringify(r).includes('"' + cachee + '"'), 'carte cachée envoyée au client');
    assert.ok(!JSON.stringify(r).includes('paquet'));
    assert.equal(r.data.moi.solde, 900);
    r = appel({ action: 'rester', jeton });
    t = r.data.table;
  }
  assert.equal(t.phase, 'fin');
  const moi = t.places[0];
  assert.equal(r.data.moi.solde, 1000 - 100 + moi.gain);
});

test('anti-triche : une seule mise par manche, pas d\'action hors tour', () => {
  const { appel } = backend();
  const a = inscrire(appel, 'Alice');
  const b = inscrire(appel, 'Bob');
  appel({ action: 'asseoir', jeton: a });
  appel({ action: 'asseoir', jeton: b });
  appel({ action: 'miser', jeton: a, mise: 50 });
  assert.equal(appel({ action: 'miser', jeton: a, mise: 50 }).erreur, 'deja_mise');
  const r = appel({ action: 'miser', jeton: b, mise: 50 }); // tout le monde a misé : distribution
  const t = r.data.table;
  if (t.phase === 'jeu') {
    const autre = t.tour === 'Alice' ? b : a;
    assert.equal(appel({ action: 'tirer', jeton: autre }).erreur, 'pas_ton_tour');
    assert.equal(appel({ action: 'miser', jeton: autre, mise: 50 }).erreur, 'mises_fermees');
  }
});

test('solde insuffisant refusé ; faillite renflouée', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  appel({ action: 'asseoir', jeton });
  services.feuilles.get('Joueurs').lignes[1][4] = 40;
  assert.equal(appel({ action: 'miser', jeton, mise: 50 }).erreur, 'solde_insuffisant');
  services.feuilles.get('Joueurs').lignes[1][4] = 5;
  const r = appel({ action: 'miser', jeton, mise: 50 });
  assert.equal(r.ok, true);
  assert.equal(services.feuilles.get('Joueurs').lignes[1][5], 1, 'faillite comptée');
});

test('limitation : requêtes par session et inscriptions globales', () => {
  const { appel } = backend();
  const jeton = inscrire(appel, 'Alice');
  let bloque = false;
  for (let i = 0; i < 100 && !bloque; i++) bloque = appel({ action: 'etat', jeton }).erreur === 'trop_de_requetes';
  assert.ok(bloque, 'aucune limite par session');

  const { appel: appel2 } = backend();
  let refus = null;
  for (let i = 0; i < 40 && !refus; i++) {
    const r = appel2({ action: 'inscription', pseudo: 'joueur_' + i });
    if (!r.ok) refus = r.erreur;
  }
  assert.equal(refus, 'trop_de_requetes');
});

test('limitation : un joueur sous le quota n\'est jamais bloqué, même sur la durée', () => {
  // Régression : le compteur ne retombait jamais tant que le client restait actif
  // (put() repousse l'expiration), et un joueur honnête était bloqué après 90 sondages.
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  for (let i = 0; i < 200; i++) { // 10 min à 1 sondage / 3 s = 20 req/min, quota 90/min
    const r = appel({ action: 'etat', jeton });
    assert.equal(r.ok, true, 'sondage ' + i + ' refusé : ' + r.erreur);
    services.horloge.avancer(3000);
  }
});

test('limitation : le blocage est levé à la fenêtre suivante', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  let bloque = false;
  for (let i = 0; i < 100 && !bloque; i++) bloque = appel({ action: 'etat', jeton }).erreur === 'trop_de_requetes';
  assert.ok(bloque);
  services.horloge.avancer(61000);
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
});

test('limitation : inscriptions étalées acceptées, pseudo déjà pris non décompté', () => {
  const { appel, services } = backend();
  for (let i = 0; i < 40; i++) { // 1 inscription / 10 min = 6/h, quota 30/h
    assert.equal(appel({ action: 'inscription', pseudo: 'eleve_' + i }).ok, true, 'inscription ' + i);
    services.horloge.avancer(600000);
  }
  const { appel: appel2 } = backend();
  inscrire(appel2, 'Alice');
  for (let i = 0; i < 40; i++) assert.equal(appel2({ action: 'inscription', pseudo: 'alice' }).erreur, 'pseudo_pris');
  assert.equal(appel2({ action: 'inscription', pseudo: 'Bob' }).ok, true, 'quota épuisé par des pseudos déjà pris');
});

test('suppression du compte : session révoquée, pseudo libéré, table quittée', () => {
  const { appel } = backend();
  const jeton = inscrire(appel, 'Alice');
  appel({ action: 'asseoir', jeton });
  assert.equal(appel({ action: 'supprimerCompte', jeton }).ok, true);
  assert.equal(appel({ action: 'etat', jeton }).erreur, 'session_invalide');
  const autre = inscrire(appel, 'Alice');
  assert.equal(appel({ action: 'etat', jeton: autre }).data.table.places.length, 0);
});

test('classement : seulement pseudo et solde, trié', () => {
  const { appel, services } = backend();
  inscrire(appel, 'Alice');
  inscrire(appel, 'Bob');
  services.feuilles.get('Joueurs').lignes[2][4] = 5000;
  const r = appel({ action: 'classement' });
  assert.deepEqual(r.data.top.map((x) => x.pseudo), ['Bob', 'Alice']);
  assert.deepEqual(Object.keys(r.data.top[0]).sort(), ['pseudo', 'solde']);
});

test('anti-injection de formule dans le journal', () => {
  const { ctx } = backend();
  assert.equal(ctx.neutraliserCellule_('=1+1'), "'=1+1");
  assert.equal(ctx.neutraliserCellule_('-2'), "'-2");
  assert.equal(ctx.neutraliserCellule_('@x'), "'@x");
  assert.equal(ctx.neutraliserCellule_('Alice'), 'Alice');
  assert.equal(ctx.neutraliserCellule_(-50), -50, 'les nombres ne sont pas touchés');
});

test('etat : verrou pris par une autre requête, on renvoie l\'état sans attendre', () => {
  const { appel, ctx, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  appel({ action: 'asseoir', jeton });
  // Une transition est due (échéance dépassée), mais le verrou est occupé.
  const table = JSON.parse(services.proprietes.get('TABLE'));
  table.echeance = Date.now() - 1000;
  services.proprietes.set('TABLE', JSON.stringify(table));
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock() {} }) };
  const r = appel({ action: 'etat', jeton });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(appel({ action: 'quitter', jeton }).erreur, 'serveur_occupe', 'les actions, elles, attendent le verrou');
  assert.equal(services.proprietes.get('TABLE'), JSON.stringify(table), 'table intacte tant que le verrou est pris');
});

test('journal : plusieurs mouvements d\'une même requête écrits ensemble, dans l\'ordre', () => {
  const { appel, services } = backend();
  const a = inscrire(appel, 'Alice');
  const b = inscrire(appel, 'Bob');
  appel({ action: 'asseoir', jeton: a });
  appel({ action: 'asseoir', jeton: b });
  appel({ action: 'miser', jeton: a, mise: 50 });
  appel({ action: 'miser', jeton: b, mise: 50 });
  const journal = services.feuilles.get('Journal').lignes.slice(1).map((l) => l[2]);
  assert.deepEqual(journal.slice(0, 4), ['inscription', 'inscription', 'mise', 'mise']);
  assert.ok(journal.every((e) => typeof e === 'string' && e.length > 0), JSON.stringify(journal));
  const joueurs = services.feuilles.get('Joueurs').lignes;
  assert.equal(Object.prototype.toString.call(joueurs[1][6]), '[object Date]', 'cree_le conservé');
});

test('all in : mise tout le solde, au-delà de MISE_MAX, montant décidé par le serveur', () => {
  const { appel, services } = backend();
  const a = inscrire(appel, 'Alice');
  const b = inscrire(appel, 'Bob');
  appel({ action: 'asseoir', jeton: a });
  appel({ action: 'asseoir', jeton: b });
  services.feuilles.get('Joueurs').lignes[1][4] = 2345;
  // Un montant envoyé par le client est ignoré : seul le solde compte.
  const r = appel({ action: 'toutMiser', jeton: a, mise: 999999 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.moi.solde, 0);
  assert.equal(r.data.table.places.find((p) => p.moi).mise, 2345);
  assert.equal(appel({ action: 'toutMiser', jeton: a }).erreur, 'deja_mise');
  const journal = services.feuilles.get('Journal').lignes.map((l) => l[2] + ':' + l[3]);
  assert.ok(journal.includes("all_in:'-2345"), JSON.stringify(journal)); // ' = anti-injection de formule
  // miser garde son plafond.
  assert.equal(appel({ action: 'miser', jeton: b, mise: 501 }).erreur, 'mise_invalide');
});

test('all in : en faillite, le joueur est renfloué puis mise les 1 000', () => {
  const { appel, services } = backend();
  const a = inscrire(appel, 'Alice');
  const b = inscrire(appel, 'Bob');
  appel({ action: 'asseoir', jeton: a });
  appel({ action: 'asseoir', jeton: b }); // Bob n'a pas misé : la manche ne part pas
  services.feuilles.get('Joueurs').lignes[1][4] = 3;
  const r = appel({ action: 'toutMiser', jeton: a });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.table.places.find((p) => p.moi).mise, 1000);
  assert.equal(r.data.moi.solde, 0);
  assert.equal(services.feuilles.get('Joueurs').lignes[1][5], 1, 'faillite comptée');
  const journal = services.feuilles.get('Journal').lignes.map((l) => l[2]);
  assert.ok(journal.includes('faillite+all_in'), JSON.stringify(journal));
});

test('all in : refusé hors phase de mises ou sans être assis', () => {
  const { appel } = backend();
  const a = inscrire(appel, 'Alice');
  assert.equal(appel({ action: 'toutMiser', jeton: a }).erreur, 'pas_assis');
  assert.equal(appel({ action: 'toutMiser' }).erreur, 'session_invalide');
});

/* ---------- Fiches joueur en cache : etat sans Sheet ---------- */

test('etat : aucun accès au Sheet quand la fiche est en cache', () => {
  const { appel, ctx } = backend();
  const jeton = inscrire(appel, 'Alice');
  appel({ action: 'asseoir', jeton });
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('Sheet lu pendant le sondage'); } };
  for (let i = 0; i < 3; i++) {
    const r = appel({ action: 'etat', jeton });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.data.moi.solde, 1000);
    assert.equal(r.data.moi.pseudo, 'Alice');
  }
});

test('etat : cache vidé, le Sheet est relu puis la fiche remise en cache', () => {
  const { appel, ctx, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  services.cache.clear();
  assert.equal(appel({ action: 'etat', jeton }).data.moi.solde, 1000);
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('Sheet relu'); } };
  assert.equal(appel({ action: 'etat', jeton }).ok, true, 'fiche remise en cache au sondage précédent');
});

test('etat : verrou occupé et cache vide, on lit le Sheet sans remplir le cache', () => {
  const { appel, ctx, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  services.cache.clear();
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock() {} }) };
  assert.equal(appel({ action: 'etat', jeton }).data.moi.solde, 1000);
  assert.ok(![...services.cache.keys()].some((k) => k.startsWith('j:')), 'fiche écrite hors verrou');
});

test('etat : le solde affiché suit le Sheet après mises et gains (tous les joueurs)', () => {
  const { appel, services } = backend();
  const jetons = ['Alice', 'Bob', 'Chloe'].map((p) => inscrire(appel, p));
  jetons.forEach((jeton) => appel({ action: 'asseoir', jeton }));
  for (let manche = 0; manche < 5; manche++) {
    jetons.forEach((jeton) => appel({ action: 'miser', jeton, mise: 50 }));
    // Chacun reste à son tour : la manche se règle et crédite les gagnants.
    for (let garde = 0; garde < 10; garde++) {
      const t = JSON.parse(services.proprietes.get('TABLE'));
      if (t.phase !== 'jeu') break;
      const j = jetons.find((x) => appel({ action: 'etat', jeton: x }).data.table.monTour);
      appel({ action: 'rester', jeton: j });
    }
    const lignes = services.feuilles.get('Joueurs').lignes;
    jetons.forEach((jeton, i) => {
      assert.equal(appel({ action: 'etat', jeton }).data.moi.solde, lignes[i + 1][4], 'manche ' + manche + ', joueur ' + i);
    });
    // Fin de manche écoulée : nouvelle manche.
    const t = JSON.parse(services.proprietes.get('TABLE'));
    t.echeance = Date.now() - 1;
    services.proprietes.set('TABLE', JSON.stringify(t));
    appel({ action: 'etat', jeton: jetons[0] });
  }
});

test('suppression de compte : la fiche quitte le cache, le jeton ne marche plus', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
  assert.equal(appel({ action: 'supprimerCompte', jeton }).ok, true);
  assert.ok(![...services.cache.keys()].some((k) => k.startsWith('j:')));
  assert.equal(appel({ action: 'etat', jeton }).erreur, 'session_invalide');
});

test('etat : un jeton inconnu ne prend jamais le verrou global (anti-blocage, audit OWASP n°1)', () => {
  const { appel, ctx } = backend();
  inscrire(appel, 'Alice');
  let verrous = 0;
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => { verrous++; return true; }, releaseLock() {} }) };
  for (let i = 0; i < 20; i++) {
    const jeton = require('node:crypto').randomBytes(32).toString('hex');
    assert.equal(appel({ action: 'etat', jeton }).erreur, 'session_invalide');
  }
  assert.equal(verrous, 0, 'verrou pris pour un jeton inconnu');
});

/* ---------- Audit de sécurité du 2026-11-10 (docs/audit-securite.md) ---------- */

const JOUR = 24 * 3600 * 1000;
const jetonAleatoire = () => require('node:crypto').randomBytes(32).toString('hex');

test('audit n°3 : au-delà du seuil global de jetons inconnus, le Sheet n\'est plus lu', () => {
  const { appel, ctx, services } = backend();
  const alice = inscrire(appel, 'Alice');
  const bob = inscrire(appel, 'Bob');
  assert.equal(appel({ action: 'etat', jeton: alice }).ok, true); // fiche d'Alice en cache
  for (let i = 0; i < 300; i++) assert.equal(appel({ action: 'etat', jeton: jetonAleatoire() }).erreur, 'session_invalide');

  const vrai = ctx.SpreadsheetApp;
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('Sheet lu malgré le seuil'); } };
  assert.equal(appel({ action: 'etat', jeton: jetonAleatoire() }).erreur, 'trop_de_requetes');
  assert.equal(appel({ action: 'etat', jeton: alice }).ok, true, 'un joueur en cache continue de jouer');
  ctx.SpreadsheetApp = vrai;

  services.cache.forEach((v, k) => { if (k.startsWith('j:')) services.cache.delete(k); });
  assert.equal(appel({ action: 'etat', jeton: bob }).erreur, 'trop_de_requetes', 'hors cache : refusé pendant la rafale');
  services.horloge.avancer(61000);
  assert.equal(appel({ action: 'etat', jeton: bob }).ok, true, 'fenêtre suivante : le joueur revient');
  assert.equal(appel({ action: 'etat', jeton: jetonAleatoire() }).erreur, 'session_invalide');
});

test('audit n°5 : compte expiré masqué du classement, pseudo libéré à la réinscription', () => {
  const { appel, ctx, services } = backend();
  const ancien = inscrire(appel, 'Fantome');
  inscrire(appel, 'Alice');
  const joueurs = services.feuilles.get('Joueurs');
  joueurs.lignes[1][3] = Date.now() - 1;
  ctx.viderCacheJoueurs();
  services.cache.clear();
  assert.deepEqual(appel({ action: 'classement' }).data.top.map((x) => x.pseudo), ['Alice']);

  const nouveau = inscrire(appel, 'fantome');
  assert.equal(joueurs.lignes.length, 3, 'l\'ancienne ligne est supprimée, pas doublée');
  assert.equal(appel({ action: 'etat', jeton: ancien }).erreur, 'session_invalide');
  assert.equal(appel({ action: 'etat', jeton: nouveau }).data.moi.solde, 1000);
  assert.equal(appel({ action: 'inscription', pseudo: 'ALICE' }).erreur, 'pseudo_pris', 'un compte valide reste protégé');
});

test('audit n°5 : purge des comptes expirés (sauf à la table) et du vieux journal', () => {
  const { appel, ctx, services } = backend();
  const alice = inscrire(appel, 'Alice');
  inscrire(appel, 'Bob');
  const carol = inscrire(appel, 'Carol');
  inscrire(appel, 'Dave');
  appel({ action: 'asseoir', jeton: carol });
  const joueurs = services.feuilles.get('Joueurs');
  joueurs.lignes[2][3] = Date.now() - 1; // Bob : expiré
  joueurs.lignes[3][3] = Date.now() - 1; // Carol : expirée mais assise
  const journal = services.feuilles.get('Journal');
  const avant = journal.lignes.length;
  journal.lignes[1][0] = new Date(Date.now() - 40 * JOUR);
  journal.lignes[2][0] = new Date(Date.now() - 31 * JOUR);

  ctx.purgerComptesExpires();
  assert.deepEqual(joueurs.lignes.slice(1).map((l) => l[0]), ['Alice', 'Carol', 'Dave']);
  assert.equal(journal.lignes.length, avant - 2);
  assert.equal(journal.lignes[0][0], 'date', 'en-tête du journal conservé');
  assert.equal(appel({ action: 'etat', jeton: alice }).ok, true);
  assert.equal(appel({ action: 'inscription', pseudo: 'Bob' }).ok, true, 'pseudo libéré');
});

test('audit n°6 : la session n\'est renouvelée que sous verrou', () => {
  const { appel, ctx, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  const ligne = services.feuilles.get('Joueurs').lignes[1];
  const bientot = Date.now() + 10 * JOUR; // renouvellement dû (moins de 29 jours restants)
  ligne[3] = bientot;
  ctx.viderCacheJoueurs();

  const vrai = ctx.LockService;
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock() {} }) };
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
  assert.equal(ligne[3], bientot, 'expiration écrite hors verrou');

  ctx.LockService = vrai;
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
  assert.ok(ligne[3] > Date.now() + 29 * JOUR, 'renouvelée sous verrou');
});

test('audit n°7 : pseudos trompeurs ou piégés refusés', () => {
  const { appel } = backend();
  for (const p of ['Croupier_', 'Cr0upier', '_croupier', 'Admin_', 'adm1n', '4dmin', 'Moderateur1', 'le_root', '__proto__', '__defineGetter__']) {
    assert.equal(appel({ action: 'inscription', pseudo: p }).erreur, 'pseudo_pris', p);
  }
  for (const p of ['Alice', 'constructor', 'toString', 'a_b_c', '007']) {
    assert.equal(appel({ action: 'inscription', pseudo: p }).ok, true, p);
  }
});

test('audit n°8 : supprimer son compte après « Rester » ne laisse ni place ni gain', () => {
  const { appel, services } = backend();
  const alice = inscrire(appel, 'Alice');
  const bob = inscrire(appel, 'Bob');
  for (let essai = 0; essai < 200; essai++) {
    appel({ action: 'asseoir', jeton: alice });
    appel({ action: 'asseoir', jeton: bob });
    appel({ action: 'miser', jeton: alice, mise: 10 });
    let r = appel({ action: 'miser', jeton: bob, mise: 10 });
    if (r.data.table.phase === 'jeu' && r.data.table.tour === 'Alice') {
      r = appel({ action: 'rester', jeton: alice });
      if (r.data.table.phase === 'jeu') {
        assert.equal(appel({ action: 'supprimerCompte', jeton: alice }).ok, true);
        const vue = appel({ action: 'etat', jeton: bob }).data.table;
        assert.deepEqual(vue.places.map((p) => p.pseudo), ['Bob']);
        return;
      }
    }
    services.proprietes.clear(); // table remise à zéro, on retente une autre donne
  }
  assert.fail('aucune donne exploitable en 200 essais');
});
