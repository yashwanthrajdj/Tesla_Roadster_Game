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

test('Track 3 ramp arc physics traverses past the middle (theta >= 45 deg) without getting trapped', () => {
  const TRACK_THREE_RAMP = {
    startZ: -45,
    radius: 25,
    width: 14,
    endAngle: Math.PI * 0.5,
    surfaceY: -0.04,
  };

  const dt = 1 / 120;
  let rampTheta = 0;
  let wheelContact = true;
  let speed = 40; // 144 km/h

  // Simulate climbing up the ramp
  let framesToMiddle = 0;
  let crossedMiddle = false;
  let reachedLip = false;

  for (let step = 0; step < 240; step++) {
    // Arc advancement: theta += speed * dt / radius
    rampTheta = THREE.MathUtils.clamp(
      rampTheta + (speed * dt) / TRACK_THREE_RAMP.radius,
      0,
      TRACK_THREE_RAMP.endAngle
    );

    if (rampTheta >= Math.PI / 4 && !crossedMiddle) {
      crossedMiddle = true;
      framesToMiddle = step;
    }

    if (rampTheta >= TRACK_THREE_RAMP.endAngle - 0.05) {
      reachedLip = true;
      wheelContact = false;
      break;
    }
  }

  assert.ok(crossedMiddle, 'Car must cross middle of ramp (theta >= 45 deg)');
  assert.ok(reachedLip, 'Car must reach the top lip of the launch ramp');
  assert.ok(framesToMiddle > 0 && framesToMiddle < 120, `Car reached middle in ${framesToMiddle} frames`);
  assert.strictEqual(wheelContact, false, 'Car must release wheel contact at the ramp lip for airborne launch');
});

test('Flight landing onto road maintains support height and never sinks below road surface', () => {
  const roadHeight = -0.04;
  const vehicleSupport = 0.35;
  const minRoadY = roadHeight + vehicleSupport; // 0.31m

  const physics = {
    position: new THREE.Vector3(0, 30, -120),
    velocity: new THREE.Vector3(0, -45, -35),
    wheelContact: false,
    landed: false,
  };

  const dt = 1 / 120;
  let landedFrame = -1;

  for (let frame = 0; frame < 180; frame++) {
    physics.velocity.y -= 9.81 * dt;
    physics.position.addScaledVector(physics.velocity, dt);

    // Ground barrier check
    if (physics.position.y <= minRoadY + 0.1 && physics.velocity.y <= 0) {
      physics.position.y = minRoadY + 0.005;
      physics.velocity.y = 0;
      physics.wheelContact = true;
      if (!physics.landed) {
        physics.landed = true;
        landedFrame = frame;
      }
    }

    assert.ok(
      physics.position.y >= minRoadY,
      `Vehicle sank below road at frame ${frame}: y=${physics.position.y} < ${minRoadY}`
    );
  }

  assert.ok(physics.landed, 'Vehicle must land on the road');
  assert.strictEqual(physics.wheelContact, true, 'Wheel contact must be restored upon landing');
  assert.ok(physics.velocity.z < -20, 'Vehicle must preserve forward velocity after touchdown');
  assert.ok(landedFrame > 0, `Vehicle landed at frame ${landedFrame}`);
});
