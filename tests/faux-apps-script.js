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
  const cache = new Map();
  return {
    feuilles,
    proprietes,
    cache,
    SpreadsheetApp: { getActiveSpreadsheet: () => classeur },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (proprietes.has(k) ? proprietes.get(k) : null),
        setProperty: (k, v) => { proprietes.set(k, String(v)); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); }
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
