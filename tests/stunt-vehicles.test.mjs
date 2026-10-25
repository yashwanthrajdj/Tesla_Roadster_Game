import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STUNT_FORMATION, STUNT_LANE_COUNT, STUNT_PARKING_LANE_X, STUNT_VEHICLE_ASSETS, STUNT_VEHICLE_LENGTH, getStuntVehicleLayout, getStuntVehicleRotation, normalizeStuntFormation } from '../src/stunt-vehicles.js';

test('stunt formation clamps count and spacing to the settings contract', () => {
  assert.deepEqual(normalizeStuntFormation({ count: 99, spacing: -4 }), { count: 5, spacing: 1 });
  assert.deepEqual(normalizeStuntFormation({ count: 2.6, spacing: 2.25 }), { count: 3, spacing: 2.25 });
  assert.deepEqual(normalizeStuntFormation(), DEFAULT_STUNT_FORMATION);
});

test('stunt vehicles park one behind another in one lane', () => {
  const layout = getStuntVehicleLayout({ count: 5, spacing: 3.5 });
  assert.equal(STUNT_VEHICLE_ASSETS.length, 5);
  assert.equal(STUNT_LANE_COUNT, 6);
  assert.equal(getStuntVehicleRotation(), Math.PI);
  assert.equal(layout.positions.length, 5);
  assert.ok(layout.positions.every(({ x, lane }) => x === STUNT_PARKING_LANE_X && lane === 3));
  assert.equal(layout.positions[0].z, 0);
  assert.equal(layout.positions[1].z - layout.positions[0].z, -(STUNT_VEHICLE_LENGTH + 3.5));
  assert.ok(layout.positions.every(({ z }, index) => index === 0 || z < layout.positions[index - 1].z));
});
