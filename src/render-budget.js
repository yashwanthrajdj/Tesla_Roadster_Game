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

export function pixelRatioFor(width, height, deviceRatio = 1, quality = 'auto', adaptiveScale = 1) {
  const cap = quality === 'low' ? 0.8 : quality === 'high' ? 1.5 : quality === 'balanced' ? 1 : 1.25;
  const pixelBudget = quality === 'low' ? 600_000 : quality === 'high' ? 1_800_000 : 1_000_000;
  return Math.max(0.5, Math.min(deviceRatio, cap, Math.sqrt(pixelBudget / Math.max(1, width * height))) * adaptiveScale);
}

export class AdaptiveResolution {
  constructor() { this.scale = 1; this.elapsed = 0; this.frames = 0; }
  sample(dt) {
    // Ignore long tab switches; never sacrifice collision substeps for FPS.
    if (dt > 0.25) return false;
    this.elapsed += dt; this.frames++;
    if (this.elapsed < 3) return false;
    const average = this.elapsed / this.frames;
    const previous = this.scale;
    if (average > 1 / 42) this.scale = Math.max(0.65, this.scale - 0.1);
    else if (average < 1 / 58) this.scale = Math.min(1, this.scale + 0.05);
    this.elapsed = 0; this.frames = 0;
    return this.scale !== previous;
  }
}
