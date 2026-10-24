import * as THREE from 'three';

// Positions come from the actual transformed lamp vertices, not the model
// origin: this GLB stores both headlights in one mesh and has nested rotations.
export function measureVehicleLamps(model) {
  model.updateMatrixWorld(true);
  const head = [new THREE.Box3(), new THREE.Box3()];
  const tail = [new THREE.Box3(), new THREE.Box3()];
  const materials = new Map();
  const point = new THREE.Vector3();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const names = `${mesh.name} ${list.map((m) => m.name).join(' ')}`;
    const kind = /headlights/i.test(names) ? 'head' : /rear.lights/i.test(names) ? 'tail' : null;
    if (!kind) return;
    list.forEach((material) => materials.set(material, kind));
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      (kind === 'head' ? head : tail)[point.x < 0 ? 0 : 1].expandByPoint(point);
    }
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const fallback = (side, front) => new THREE.Vector3(side * size.x * 0.34,
    bounds.min.y + size.y * (front ? 0.4 : 0.56), front ? bounds.min.z : bounds.max.z);
  const positions = (boxes, front) => boxes.map((box, index) => {
    if (box.isEmpty()) return fallback(index === 0 ? -1 : 1, front);
    const center = box.getCenter(new THREE.Vector3());
    // Place the beam just outside the lens so the housing does not cover it.
    center.z = (front ? box.min.z : box.max.z) + (front ? -0.035 : 0.035);
    return center;
  });
  return { head: positions(head, true), tail: positions(tail, false), materials,
    measured: head.every((box) => !box.isEmpty()) && tail.every((box) => !box.isEmpty()) };
}

export function createVehicleLights(parent) {
  const root = new THREE.Group();
  root.name = 'vehicle-light-rig';
  parent.add(root);
  const headlights = [-1, 1].map((side) => {
    const light = new THREE.SpotLight(0xfff3db, 1400, 75, 0.36, 0.7, 2);
    light.name = side < 0 ? 'left-headlight' : 'right-headlight';
    light.position.set(side * 0.7, -0.06, -2.05);
    light.target.position.set(side * 1.8, -1.6, -32);
    // No shadow map per headlight: actual road illumination at a bounded cost.
    root.add(light, light.target);
    return light;
  });
  const fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0xff331d });
  const fallbackTails = [-1, 1].map((side) => {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.055, 0.025), fallbackMaterial);
    lens.position.set(side * 0.7, 0.2, 2.1);
    root.add(lens);
    return lens;
  });
  let measured = null;
  let enabled = true;
  function update(braking = false) {
    headlights.forEach((light) => { light.intensity = enabled ? 1400 : 0; });
    measured?.materials.forEach((kind, material) => {
      material.emissive.set(kind === 'head' ? 0xfff4df : 0xff1609);
      material.emissiveIntensity = kind === 'head' ? (enabled ? 3.5 : 0) : (braking ? 4 : enabled ? 1.8 : 0);
    });
    fallbackTails.forEach((lens) => { lens.visible = !measured?.measured && (enabled || braking); });
  }
  return {
    root, headlights,
    configure(model) {
      measured = measureVehicleLamps(model);
      headlights.forEach((light, index) => {
        light.position.copy(measured.head[index]);
        light.target.position.copy(light.position).add(new THREE.Vector3(index ? 0.7 : -0.7, -1.55, -30));
        fallbackTails[index].position.copy(measured.tail[index]);
      });
      update();
      return measured;
    },
    setEnabled(value) { enabled = value; update(); },
    get enabled() { return enabled; },
    update,
  };
}
