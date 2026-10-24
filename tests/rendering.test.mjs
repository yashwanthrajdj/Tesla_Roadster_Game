import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measureVehicleLamps, createVehicleLights } from '../src/vehicle-lights.js';
import { batchScenery, pixelRatioFor, AdaptiveResolution } from '../src/render-budget.js';
import { createStreetLighting } from '../src/street-lights.js';
import { createPressureSmoke } from '../src/pressure-smoke.js';
import { loadModel } from './model-helper.mjs';

test('optimized Roadster retains actual left/right headlamp and rear lamp locations', async () => {
  const original = await loadModel('tesla-roadster-2020.glb');
  const driving = await loadModel('tesla-roadster-2020-driving.glb');
  const source = measureVehicleLamps(original), optimized = measureVehicleLamps(driving);
  assert.ok(source.measured && optimized.measured);
  for (const kind of ['head', 'tail']) {
    assert.ok(optimized[kind][0].x < 0 && optimized[kind][1].x > 0);
    optimized[kind].forEach((point, i) => {
      assert.ok(point.distanceTo(source[kind][i]) < 0.06, `${kind} moved away from its lens`);
      assert.ok(kind === 'head' ? point.z < -1.7 : point.z > 1.7);
    });
  }
  let triangles = 0;
  driving.traverse((node) => { if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; });
  assert.ok(triangles < 130000, `Model budget exceeded: ${triangles}`);
  const rig = createVehicleLights(new THREE.Group());
  rig.configure(driving);
  assert.equal(rig.headlights.length, 2);
  rig.headlights.forEach((light) => assert.ok(light.target.position.z < light.position.z));
  rig.setEnabled(false);
  rig.headlights.forEach((light) => assert.equal(light.intensity, 0));
  optimized.materials.forEach((kind, material) => assert.equal(material.emissiveIntensity, 0));
  rig.update(true);
  optimized.materials.forEach((kind, material) => { if (kind === 'tail') assert.ok(material.emissiveIntensity > 2); });
  rig.setEnabled(true);
  rig.headlights.forEach((light) => assert.ok(light.intensity > 0));
});

test('scenery batching preserves transforms while combining draw submissions', () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 20; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 4), material);
    // Keep this fixture entirely inside the [-128, 0) culling section.
    box.position.set(6, 0, -1 - i * 5); root.add(box);
  }
  batchScenery(root);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].count, 20);
  const matrix = new THREE.Matrix4();
  root.children[0].getMatrixAt(8, matrix);
  assert.equal(matrix.elements[12], 6);
  assert.equal(matrix.elements[14], -41);
  assert.ok(Math.abs(matrix.elements[0] - 0.2) < 1e-6);
});

test('street lights have a constant four-light budget across the entire highway', () => {
  const lighting = createStreetLighting(new THREE.Scene());
  for (let z = 108; z > -4922; z -= 32) {
    lighting.register(1, -13.1, 8.35, z); lighting.register(1, 13.1, 8.35, z);
  }
  lighting.register(2, -12, 6, 0); lighting.register(2, 12, 6, 0);
  for (const z of [46, -1000, -3000, -4890]) {
    lighting.update(1, new THREE.Vector3(0, 1, z), false);
    assert.equal(lighting.spots.length, 4);
    lighting.spots.forEach((light) => {
      assert.ok(Math.abs(light.position.z - z) < 64);
      assert.ok(light.intensity > 0 && !light.castShadow);
      assert.ok(light.target.position.y < light.position.y);
    });
  }
});

test('resolution budget respects DPR and responds to slow frames without lowering physics accuracy', () => {
  assert.ok(pixelRatioFor(1920, 1080, 3, 'auto') < 1);
  assert.ok(pixelRatioFor(960, 600, 3, 'low') <= 0.8);
  const adaptive = new AdaptiveResolution();
  for (let i = 0; i < 120; i++) adaptive.sample(1 / 25);
  assert.ok(adaptive.scale < 1 && adaptive.scale >= 0.65);
});

test('smoke uploads live buffers, travels from each nozzle, spreads on ground, and stays bounded', () => {
  const pool = createPressureSmoke(new THREE.Group(), 'lift', 32);
  const jet = { group: { position: new THREE.Vector3(0.6, -0.5, 1) }, direction: new THREE.Vector3(0, -1, 0) };
  const physics = { position: new THREE.Vector3(0, 2, 0), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  assert.equal(pool.positions, pool.geometry.attributes.position.array);
  assert.equal(pool.sizes, pool.geometry.attributes.size.array);
  pool.emit(jet, 1, physics);
  for (let i = 0; i < 20; i++) pool.update(1 / 60, () => 0, 600);
  const p = pool.particles[0];
  assert.ok(p.active && p.grounded);
  assert.ok(p.position.y >= 0.12);
  assert.ok(Math.hypot(p.velocity.x, p.velocity.z) > 1);
  assert.ok(pool.geometry.attributes.alpha.array[0] > 0);
  assert.ok(pool.sizes[0] > p.size);
  physics.position.set(100, 100, 100);
  assert.ok(p.position.x < 10, 'Emitted smoke must not remain parented to the car');
  for (let i = 0; i < 100; i++) pool.emit(jet, 1, physics);
  assert.equal(pool.particles.length, 32);
  for (let i = 0; i < 150; i++) pool.update(1 / 60, () => 0, 600);
  assert.ok(pool.particles.every((particle) => !particle.active));
  pool.clear();
  assert.ok(pool.alphas.every((value) => value === 0));
});
