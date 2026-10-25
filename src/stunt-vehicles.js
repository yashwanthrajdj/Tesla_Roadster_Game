import * as THREE from 'three';

export const STUNT_LANE_COUNT = 6;
export const STUNT_LANE_WIDTH = 6;
export const STUNT_ROAD_WIDTH = STUNT_LANE_COUNT * STUNT_LANE_WIDTH;
export const STUNT_VEHICLE_LENGTH = 4.8;
export const STUNT_PARKING_LANE_X = -3;

export const STUNT_VEHICLE_ASSETS = Object.freeze([
  { id: 'cybertruck', label: 'CYBERTRUCK', url: '/models/stunt/tesla-cybertruck.glb' },
  { id: 'cybertruck-black', label: 'CYBERTRUCK BLACK', url: '/models/stunt/tesla-cybertruck-black.glb' },
  { id: 'semi', label: 'TESLA SEMI', url: '/models/stunt/tesla-semi.glb' },
  { id: 'affordable', label: 'TESLA COMPACT', url: '/models/stunt/tesla-affordable.glb' },
  { id: 'spaceship', label: 'TESLA SPACESHIP', url: '/models/stunt/tesla-spaceship.glb' },
]);

export const DEFAULT_STUNT_FORMATION = Object.freeze({ count: 3, spacing: 4 });

export function normalizeStuntFormation(value = {}) {
  const count = THREE.MathUtils.clamp(Math.round(Number(value.count ?? DEFAULT_STUNT_FORMATION.count)), 1, 5);
  const spacing = THREE.MathUtils.clamp(Number(value.spacing ?? DEFAULT_STUNT_FORMATION.spacing), 1, 12);
  return { count, spacing: Number.isFinite(spacing) ? spacing : DEFAULT_STUNT_FORMATION.spacing };
}

export function getStuntVehicleLayout(value = DEFAULT_STUNT_FORMATION, roadWidth = STUNT_ROAD_WIDTH) {
  const { count, spacing } = normalizeStuntFormation(value);
  const step = STUNT_VEHICLE_LENGTH + spacing;
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    positions.push({
      x: STUNT_PARKING_LANE_X,
      z: index === 0 ? 0 : -index * step,
      lane: 3,
    });
  }
  return { count, spacing, step, roadWidth, positions };
}

export function getStuntVehicleRotation() {
  return Math.PI;
}
