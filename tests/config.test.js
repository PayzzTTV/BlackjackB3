'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('config.js commité ne contient que l\'URL factice (la vraie vit dans le secret BJ_API_URL)', () => {
  const contenu = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'config.js'), 'utf8');
  const urls = contenu.match(/https:\/\/script\.google\.com\/macros\/s\/[^/'"]+\/exec/g) || [];
  assert.deepEqual(urls, ['https://script.google.com/macros/s/REMPLACER_PAR_ID_DEPLOIEMENT/exec']);
});
