import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadRawModel } from './model-helper.mjs';

test('Track 3 vertical launch ramp model loads and has valid hierarchy and dimensions', async () => {
  const model = await loadRawModel('Untitled.glb');
  assert.ok(model);

  let meshCount = 0;
  let warmEdgeFound = false;
  let rampShellFound = false;
  let trussFound = false;

  model.traverse((node) => {
    if (node.isMesh) {
      meshCount += 1;
      if (node.name.includes('Warm_edge') || node.name.includes('warm_edge')) warmEdgeFound = true;
      if (node.name.includes('Reference_ramp_shell') || node.name.includes('ramp_shell')) rampShellFound = true;
      if (node.name.includes('Truss') || node.name.includes('truss')) trussFound = true;
    }
  });

  assert.ok(meshCount > 50, `Expected >50 meshes in Untitled.glb, got ${meshCount}`);
  assert.ok(warmEdgeFound, 'Expected warm edge rail in ramp model');
  assert.ok(rampShellFound, 'Expected ramp shell in ramp model');
  assert.ok(trussFound, 'Expected truss cage in ramp model');

  // Verify bounding box with 90-degree X rotation (matching game orientation)
  const group = new THREE.Group();
  group.add(model);
  model.rotation.x = Math.PI / 2;
  model.updateMatrixWorld(true);

  const box = new THREE.Box3();
  model.traverse((node) => {
    if (node.isMesh && !node.name.includes('Test-range_ground') && !node.name.includes('Test-range ground')) {
      box.expandByObject(node);
    }
  });

  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 13 && size.x < 25, `Ramp width expected ~14-22m, got ${size.x}`);
  assert.ok(size.y > 24 && size.y < 35, `Ramp height expected ~25-32m, got ${size.y}`);
  assert.ok(size.z > 50 && size.z < 65, `Ramp footprint length expected ~58m, got ${size.z}`);
});
