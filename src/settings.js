export const DEFAULT_SETTINGS = Object.freeze({
  steeringSensitivity: 1,
  speedControl: 1,
  thrustSensitivity: 1,
  spinSensitivity: 1,
  spiralSensitivity: 1,
  gyroSensitivity: 1,
  gyroEnabled: false,
  stabilizeInAir: true,
  autoThrust: false,
  stuntVehicleCount: 3,
  stuntVehicleSpacing: 4,
});

export const SETTING_RANGES = Object.freeze({
  steeringSensitivity: [0.25, 2, 0.05],
  speedControl: [0.5, 1.5, 0.05],
  thrustSensitivity: [0.5, 1.5, 0.05],
  spinSensitivity: [0.5, 1.75, 0.05],
  spiralSensitivity: [0.25, 2, 0.05],
  gyroSensitivity: [0.25, 2, 0.05],
  stuntVehicleCount: [1, 5, 1],
  stuntVehicleSpacing: [1, 12, 0.5],
});

function clampValue(key, value) {
  if (!(key in SETTING_RANGES)) return Boolean(value);
  const [min, max] = SETTING_RANGES[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : DEFAULT_SETTINGS[key];
}

export function normalizeSettings(value = {}) {
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, clampValue(key, value[key] ?? DEFAULT_SETTINGS[key])]));
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem('roadster-thrust-settings');
    return normalizeSettings(raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeSettings(settings);
  try { storage?.setItem('roadster-thrust-settings', JSON.stringify(normalized)); } catch { /* private mode */ }
  return normalized;
}

export function formatSettingValue(key, value) {
  if (key === 'speedControl') return `${Math.round(Number(value) * 100)}% max speed`;
  if (key === 'gyroSensitivity') return `${Number(value).toFixed(2)}× gyro`;
  if (key === 'stuntVehicleCount') return `${Math.round(Number(value))} VEHICLE${Number(value) === 1 ? '' : 'S'}`;
  if (key === 'stuntVehicleSpacing') return `${Number(value).toFixed(2)}M GAP`;
  return `${Number(value).toFixed(2)}×`;
}
