import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrackOneVegetation, normalizeVegetationSettings } from '../src/vegetation.js';

test('vegetation settings normalize density and preserve independent visibility controls', () => {
  assert.deepEqual(normalizeVegetationSettings({ vegetationDensity: 99, bushesEnabled: false }), {
    vegetationEnabled: true,
    bushesEnabled: false,
    treesEnabled: true,
    vegetationDensity: 1.5,
  });
});

test('Track 01 vegetation builds layered instanced bushes and trees beside the road', () => {
  const root = new THREE.Group();
  const vegetation = createTrackOneVegetation(root, { vegetationDensity: 1 });
  const stats = vegetation.getStats();
  assert.ok(stats.bushes > 300);
  assert.ok(stats.trees > 150);
  assert.equal(stats.bushLayers, 4);
  assert.equal(stats.treeLayers, 5);
  assert.ok(vegetation.bushesRoot.children.every((child) => child.isInstancedMesh));
  assert.ok(vegetation.treesRoot.children.every((child) => child.isInstancedMesh));
  vegetation.update({ vegetationEnabled: false, bushesEnabled: true, treesEnabled: true, vegetationDensity: 1 });
  assert.equal(vegetation.root.visible, false);
  vegetation.update({ vegetationEnabled: true, bushesEnabled: false, treesEnabled: true, vegetationDensity: 1 });
  assert.equal(vegetation.bushesRoot.visible, false);
  assert.equal(vegetation.treesRoot.visible, true);
});
