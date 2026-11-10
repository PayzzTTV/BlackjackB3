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
  for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'initialiser', 'reinitialiserTable']) {
    assert.equal(appel({ action: a }).erreur, 'action_inconnue', a);
  }
  assert.equal(JSON.parse(ctx.doPost({}).contenu).erreur, 'requete_invalide');
  assert.equal(JSON.parse(ctx.doGet().contenu).ok, false);
});

test('erreur interne : message générique, aucune trace', () => {
  const { appel, ctx } = backend();
  const jeton = inscrire(appel, 'Alice');
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('secret interne /chemin'); } };
  const r = appel({ action: 'etat', jeton });
  assert.equal(r.erreur, 'erreur_serveur');
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('sessions : jeton absent, malformé, inconnu ou expiré refusé', () => {
  const { appel, services } = backend();
  const jeton = inscrire(appel, 'Alice');
  for (const j of [undefined, '', 'abc', jeton.toUpperCase(), jeton + '0', 'f'.repeat(64), 123, { $ne: null }]) {
    assert.equal(appel({ action: 'etat', jeton: j }).erreur, 'session_invalide', String(j));
  }
  assert.equal(appel({ action: 'etat', jeton }).ok, true);
  services.feuilles.get('Joueurs').lignes[1][3] = Date.now() - 1; // expiration
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
