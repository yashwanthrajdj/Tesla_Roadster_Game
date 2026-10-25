import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, formatSettingValue, loadSettings, normalizeSettings, saveSettings } from '../src/settings.js';

test('settings normalize and clamp custom sensitivity values', () => {
  const settings = normalizeSettings({ steeringSensitivity: 9, speedControl: 0, gyroSensitivity: 1.35, autoThrust: true });
  assert.equal(settings.steeringSensitivity, 2);
  assert.equal(settings.speedControl, 0.5);
  assert.equal(settings.gyroSensitivity, 1.35);
  assert.equal(settings.autoThrust, true);
  assert.equal(settings.stuntVehicleCount, 3);
  assert.equal(settings.stuntVehicleSpacing, 4);
  assert.equal(settings.stabilizeInAir, DEFAULT_SETTINGS.stabilizeInAir);
  assert.equal(formatSettingValue('speedControl', 1.25), '125% max speed');
  assert.equal(formatSettingValue('stuntVehicleCount', 5), '5 VEHICLES');
  assert.equal(formatSettingValue('stuntVehicleSpacing', 2.25), '2.25M GAP');
});

test('settings persist through a storage round trip', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const saved = saveSettings({ ...DEFAULT_SETTINGS, spinSensitivity: 1.5, gyroEnabled: true }, storage);
  assert.equal(saved.spinSensitivity, 1.5);
  assert.equal(loadSettings(storage).gyroEnabled, true);
  assert.equal(loadSettings(storage).spinSensitivity, 1.5);
});
