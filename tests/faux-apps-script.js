'use strict';
/**
 * Faux services Google Apps Script (en mémoire) pour exécuter le vrai code
 * de backend/*.gs sous Node, sans aucune dépendance.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DOSSIER_BACKEND = path.join(__dirname, '..', 'backend');

/** Octets signés, comme les byte[] Java renvoyés par Utilities. */
const signes = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

class FausseFeuille {
  constructor(nom) { this.nom = nom; this.lignes = []; }
  getLastRow() { return this.lignes.length; }
  getDataRange() {
    const largeur = Math.max(1, ...this.lignes.map((l) => l.length));
    return new FaussePlage(this, 1, 1, this.lignes.length, largeur);
  }
  appendRow(valeurs) { this.lignes.push(valeurs.slice()); }
  deleteRow(n) { this.lignes.splice(n - 1, 1); }
  setFrozenRows() {}
  getRange(ligne, col, nbLignes, nbCols) {
    if (typeof ligne === 'string') return { setNumberFormat() { return this; } };
    return new FaussePlage(this, ligne, col, nbLignes || 1, nbCols || 1);
  }
}

class FaussePlage {
  constructor(feuille, ligne, col, nbLignes, nbCols) {
    Object.assign(this, { feuille, ligne, col, nbLignes, nbCols });
  }
  getValues() {
    const res = [];
    for (let i = 0; i < this.nbLignes; i++) {
      const l = this.feuille.lignes[this.ligne - 1 + i] || [];
      const r = [];
      for (let j = 0; j < this.nbCols; j++) {
        const v = l[this.col - 1 + j];
        r.push(v === undefined ? '' : v);
      }
      res.push(r);
    }
    return res;
  }
  setValues(valeurs) {
    valeurs.forEach((r, i) => {
      const idx = this.ligne - 1 + i;
      while (this.feuille.lignes.length <= idx) this.feuille.lignes.push([]);
      r.forEach((v, j) => { this.feuille.lignes[idx][this.col - 1 + j] = v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  createTextFinder(texte) {
    const plage = this;
    const finder = {
      matchEntireCell() { return finder; },
      matchCase() { return finder; },
      findNext() {
        const vals = plage.getValues();
        for (let i = 0; i < vals.length; i++) {
          if (String(vals[i][0]) === texte) return { getRow: () => plage.ligne + i };
        }
        return null;
      }
    };
    return finder;
  }
}

function creerServices() {
  const feuilles = new Map();
  const classeur = {
    getSheetByName: (n) => feuilles.get(n) || null,
    insertSheet: (n) => { const f = new FausseFeuille(n); feuilles.set(n, f); return f; }
  };
  const proprietes = new Map();
  // Horloge pilotable : horloge.avancer(ms) décale Date.now() et new Date() pour le back.
  const horloge = { decalageMs: 0, avancer(ms) { this.decalageMs += ms; } };
  const maintenant = () => Date.now() + horloge.decalageMs;
  class FausseDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(maintenant()); }
    static now() { return maintenant(); }
  }
  // Comme CacheService : chaque entrée expire, et put() repose l'expiration.
  // `cache` garde les valeurs (les tests y lisent et y écrivent), `expirations` les échéances.
  const cache = new Map();
  const expirations = new Map();
  const DUREE_DEFAUT_S = 600;
  const vivant = (k) => {
    if (!cache.has(k)) return false;
    if (expirations.has(k) && expirations.get(k) <= maintenant()) { cache.delete(k); expirations.delete(k); return false; }
    return true;
  };
  const poser = (k, v, dureeS) => { cache.set(k, String(v)); expirations.set(k, maintenant() + (dureeS || DUREE_DEFAUT_S) * 1000); };
  const oter = (k) => { cache.delete(k); expirations.delete(k); };
  return {
    feuilles,
    proprietes,
    cache,
    horloge,
    Date: FausseDate,
    SpreadsheetApp: { getActiveSpreadsheet: () => classeur },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (proprietes.has(k) ? proprietes.get(k) : null),
        setProperty: (k, v) => { proprietes.set(k, String(v)); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (vivant(k) ? cache.get(k) : null),
        getAll: (cles) => Object.fromEntries(cles.filter(vivant).map((k) => [k, cache.get(k)])),
        put: poser,
        putAll: (valeurs, dureeS) => { Object.entries(valeurs).forEach(([k, v]) => poser(k, v, dureeS)); },
        remove: oter,
        removeAll: (cles) => { cles.forEach(oter); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (algo, texte) => signes(crypto.createHash(algo).update(String(texte), 'utf8').digest())
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (contenu) => ({ contenu, setMimeType() { return this; } })
    }
  };
}

/** Charge les fichiers .gs dans un contexte isolé. */
function charger(fichiers, services) {
  const ctx = vm.createContext(Object.assign({ console: { log() {}, error() {} } }, services || {}));
  fichiers.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(DOSSIER_BACKEND, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

/** Backend complet prêt à l'emploi (Sheet initialisé). */
function backend() {
  const services = creerServices();
  const ctx = charger(['Blackjack.gs', 'Table.gs', 'Code.gs'], services);
  ctx.initialiser();
  const appel = (corps) => {
    const brut = typeof corps === 'string' ? corps : JSON.stringify(corps);
    return JSON.parse(ctx.doPost({ postData: { contents: brut } }).contenu);
  };
  return { ctx, services, appel };
}

module.exports = { charger, backend, creerServices };
