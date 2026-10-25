import * as THREE from 'three';

// Batch repeated scenery in short road sections, retaining frustum culling.
// Each marking/pole used to allocate its own geometry and draw call.
export function batchScenery(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map();
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return;
    const p = mesh.geometry.parameters;
    let shape, scale;
    if (mesh.geometry.type === 'BoxGeometry') {
      shape = 'box'; scale = new THREE.Vector3(p.width, p.height, p.depth);
    } else if (mesh.geometry.type === 'CylinderGeometry' && p.radiusTop === p.radiusBottom) {
      shape = 'pole'; scale = new THREE.Vector3(p.radiusTop, p.height, p.radiusBottom);
    } else return;
    const matrix = inverse.clone().multiply(mesh.matrixWorld).scale(scale);
    const section = Math.floor(matrix.elements[14] / 128);
    const key = `${shape}/${mesh.material.uuid}/${section}`;
    if (!groups.has(key)) groups.set(key, { shape, material: mesh.material, entries: [] });
    groups.get(key).entries.push({ mesh, matrix });
  });
  for (const { shape, material, entries } of groups.values()) {
    if (entries.length < 2) continue;
    const geometry = shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(1, 1, 1, 8);
    const batch = new THREE.InstancedMesh(geometry, material, entries.length);
    batch.name = `batched-${shape}`;
    batch.receiveShadow = true;
    entries.forEach(({ mesh, matrix }, index) => {
      batch.setMatrixAt(index, matrix);
      mesh.removeFromParent();
      mesh.geometry.dispose();
    });
    batch.computeBoundingSphere();
    root.add(batch);
  }
}

// Clarity never changes with frame time, viewport size, or a quality preset.
// Performance comes from batching and bounded effects, not a blurry canvas.
export function nativePixelRatio(deviceRatio = 1) {
  return Number.isFinite(deviceRatio) && deviceRatio > 0 ? Math.max(1, deviceRatio) : 1;
}
