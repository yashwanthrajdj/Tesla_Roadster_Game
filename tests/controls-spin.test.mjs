import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readControls } from '../src/controls.js';
import { createSpinPlan, sampleSpin } from '../src/air-spin.js';

test('arrows drive/steer without consuming thruster controls', () => {
  const input = readControls(new Set(['ArrowUp', 'ArrowLeft']));
  assert.equal(input.drive, 1); assert.equal(input.steer, 1);
  assert.equal(input.rear, 0); assert.equal(input.lift, 0); assert.equal(input.yaw, 0);
  const reverse = readControls(new Set(['ArrowDown', 'ArrowRight']));
  assert.equal(reverse.drive, -1); assert.equal(reverse.steer, -1);
  assert.equal(reverse.lift, 0);
});

test('WASD control rear/lift/yaw jets, with Space remaining a lift alias', () => {
  const thrust = readControls(new Set(['KeyW', 'KeyA', 'ShiftLeft']));
  assert.equal(thrust.rear, 1); assert.equal(thrust.yaw, 1); assert.equal(thrust.boost, 1);
  assert.equal(thrust.drive, 0); assert.equal(thrust.steer, 0);
  const lift = readControls(new Set(['KeyS', 'KeyD']));
  assert.equal(lift.lift, 1); assert.equal(lift.yaw, -1); assert.equal(lift.drive, 0);
  assert.equal(readControls(new Set(['Space'])).lift, 1);
  const cancelled = readControls(new Set(['ArrowUp', 'ArrowDown', 'KeyA', 'KeyD']));
  assert.equal(cancelled.drive, 0); assert.equal(cancelled.yaw, 0);
});

for (const direction of [-1, 1]) {
  test(`${direction < 0 ? 'Q' : 'E'} spins finish level from upright, inverted and tilted ramp orientations`, () => {
    for (const euler of [[0, 0, 0], [Math.PI, 0, 0], [0, 1.2, Math.PI], [0.7, 0.8, -1.1], [Math.PI / 2, 0, 0]]) {
      const start = new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
      const plan = createSpinPlan(start, direction);
      const output = new THREE.Quaternion();
      sampleSpin(plan, 0, output);
      assert.ok(output.angleTo(start) < 1e-6, 'Spin must not snap on start');
      for (const step of [1 / 30, 1 / 120]) {
        let complete = false;
        for (let elapsed = 0; elapsed < plan.duration + step * 2; elapsed += step) {
          complete = sampleSpin(plan, elapsed, output);
          assert.ok(Number.isFinite(output.w) && Math.abs(output.length() - 1) < 1e-6);
        }
        assert.ok(complete);
        assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(output).y > 0.99999);
        const heading = new THREE.Vector3(0, 0, -1).applyQuaternion(start).setY(0);
        if (heading.lengthSq() > 1e-5) {
          const final = new THREE.Vector3(0, 0, -1).applyQuaternion(output);
          assert.ok(final.dot(heading.normalize()) > 0.99999, 'Keep the ramp exit heading');
        }
      }
    }
    const upright = createSpinPlan(new THREE.Quaternion(), direction);
    assert.ok(Math.abs(upright.travel - Math.PI * 2) < 1e-8);
    const partial = new THREE.Quaternion();
    sampleSpin(upright, 0.12, partial);
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(partial).x * direction > 0);
    const inverted = createSpinPlan(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), direction);
    assert.ok(Math.abs(inverted.travel - Math.PI * 3) < 1e-8, 'Inverted: one roll plus half-turn recovery');
  });
}
