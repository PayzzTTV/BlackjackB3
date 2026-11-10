'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('workflows : toutes les actions sont épinglées par SHA de commit', () => {
  const dossier = path.join(__dirname, '..', '.github', 'workflows');
  const fautives = [];
  for (const f of fs.readdirSync(dossier).filter((n) => /\.ya?ml$/.test(n))) {
    const contenu = fs.readFileSync(path.join(dossier, f), 'utf8');
    for (const m of contenu.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (!/@[0-9a-f]{40}$/.test(m[1])) fautives.push(f + ' : ' + m[1]);
    }
  }
  assert.deepEqual(fautives, [], 'utiliser owner/action@<sha40> # vX.Y.Z');
});

test('config.js commité ne contient que l\'URL factice (la vraie vit dans le secret BJ_API_URL)', () => {
  const contenu = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'config.js'), 'utf8');
  const urls = contenu.match(/https:\/\/script\.google\.com\/macros\/s\/[^/'"]+\/exec/g) || [];
  assert.deepEqual(urls, ['https://script.google.com/macros/s/REMPLACER_PAR_ID_DEPLOIEMENT/exec']);
});
