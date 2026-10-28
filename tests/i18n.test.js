// Every English label must have a Spanish version (and the other way round).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('English and Spanish have the same labels', () => {
  const src = fs.readFileSync(path.join(__dirname, '../frontend/js/i18n.js'), 'utf8');
  const [enPart, esPart] = src.split('const es = {');
  const keys = (text) => new Set([...text.matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
  const en = keys(enPart);
  const es = keys(esPart);
  assert.deepEqual([...en].filter((k) => !es.has(k)), [], 'missing in Spanish');
  assert.deepEqual([...es].filter((k) => !en.has(k)), [], 'only in Spanish');
});
