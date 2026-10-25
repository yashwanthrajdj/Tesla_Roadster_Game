// One mapping for keyboard, touch buttons, and deterministic input tests.
export function readControls(keys, output = {}) {
  output.drive = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
  output.steer = Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'));
  output.rear = Number(keys.has('KeyW'));
  output.lift = Number(keys.has('KeyS') || keys.has('Space'));
  output.yaw = Number(keys.has('KeyA')) - Number(keys.has('KeyD'));
  output.roll = 0; // Q/E are keydown-triggered spin/recovery maneuvers.
  output.pitch = 0;
  output.spiral = Number(keys.has('KeyX')) - Number(keys.has('KeyZ'));
  output.boost = Number(keys.has('ShiftLeft') || keys.has('ShiftRight'));
  return output;
}
