import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const TAU = Math.PI * 2;

export function createSpinPlan(quaternion, direction, sensitivity = 1) {
  direction = direction < 0 ? -1 : 1;
  const heading = FORWARD.clone().applyQuaternion(quaternion).setY(0);
  if (heading.lengthSq() < 1e-6) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).setY(0).normalize();
    heading.crossVectors(UP, right);
  }
  if (heading.lengthSq() < 1e-6) heading.copy(FORWARD);
  heading.normalize();
  const z = heading.clone().negate();
  const x = UP.clone().cross(z).normalize();
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, UP, z));
  const currentUp = UP.clone().applyQuaternion(quaternion).projectOnPlane(heading).normalize();
  const roll = Math.atan2(heading.dot(UP.clone().cross(currentUp)), UP.dot(currentUp));
  let correction = THREE.MathUtils.euclideanModulo(-direction * roll, TAU);
  if (correction < 1e-5 || TAU - correction < 1e-5) correction = 0;
  const travel = TAU + correction;
  const base = quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD, -roll));
  return { direction, roll, travel, base, target, duration: travel / (TAU / (0.55 / Math.max(0.25, sensitivity))),
    rotation: new THREE.Quaternion() };
}

export function sampleSpin(plan, elapsed, output) {
  const progress = THREE.MathUtils.clamp(elapsed / plan.duration, 0, 1);
  if (progress >= 1) {
    output.copy(plan.target);
    return true;
  }
  const eased = progress * progress * (3 - 2 * progress);
  // Level pitch/heading while completing the roll and its directional recovery.
  // Upright starts make one 360° turn; inverted starts add 180° to finish upright.
  output.copy(plan.base).slerp(plan.target, eased);
  plan.rotation.setFromAxisAngle(FORWARD, plan.roll + plan.direction * plan.travel * eased);
  output.multiply(plan.rotation).normalize();
  return false;
}
