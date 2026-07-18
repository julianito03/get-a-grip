import assert from 'node:assert/strict';
import test from 'node:test';

import { FACE_LABELS, classifyRGB, rgbToHsv } from '../tools/segment-model.mjs';

test('keeps stable numeric labels for the browser face map', () => {
  assert.deepEqual(FACE_LABELS, ['structure', 'yellow', 'green', 'blue', 'pinkpurple', 'beigegrey', 'black']);
});

test('converts primary colours to stable hue ranges', () => {
  assert.equal(Math.round(rgbToHsv(255, 255, 0)[0]), 60);
  assert.equal(Math.round(rgbToHsv(0, 255, 0)[0]), 120);
  assert.equal(Math.round(rgbToHsv(0, 0, 255)[0]), 240);
});

test('classifies the supported climbing-route palette', () => {
  assert.equal(classifyRGB(242, 196, 12), 'yellow');
  assert.equal(classifyRGB(51, 194, 31), 'green');
  assert.equal(classifyRGB(34, 118, 232), 'blue');
  assert.equal(classifyRGB(210, 63, 174), 'pinkpurple');
  assert.equal(classifyRGB(180, 145, 105), 'beigegrey');
});

test('keeps wall-like and neutral pixels in the structure', () => {
  assert.equal(classifyRGB(8, 9, 11), 'structure');
  assert.equal(classifyRGB(95, 95, 95), 'structure');
  assert.equal(classifyRGB(240, 240, 240), 'structure');
});
