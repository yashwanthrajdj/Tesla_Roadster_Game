import * as THREE from 'three';

export const DEFAULT_VEGETATION_SETTINGS = Object.freeze({
  vegetationEnabled: true,
  bushesEnabled: true,
  treesEnabled: true,
  vegetationDensity: 1,
});

export const VEGETATION_RANGES = Object.freeze({
  vegetationDensity: [0.5, 1.5, 0.25],
});

const ROAD_START_Z = 96;
const ROAD_END_Z = -4874;
const BUSH_INTERVAL = 25;
const TREE_INTERVAL = 58;
const BUSH_SIDE_MIN = 18.8;
const BUSH_SIDE_MAX = 24.8;
const TREE_SIDE_MIN = 29;
const TREE_SIDE_MAX = 43;

function seeded(index, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function normalizeDensity(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? THREE.MathUtils.clamp(numeric, 0.5, 1.5) : DEFAULT_VEGETATION_SETTINGS.vegetationDensity;
}

export function normalizeVegetationSettings(value = {}) {
  return {
    vegetationEnabled: value.vegetationEnabled ?? DEFAULT_VEGETATION_SETTINGS.vegetationEnabled,
    bushesEnabled: value.bushesEnabled ?? DEFAULT_VEGETATION_SETTINGS.bushesEnabled,
    treesEnabled: value.treesEnabled ?? DEFAULT_VEGETATION_SETTINGS.treesEnabled,
    vegetationDensity: normalizeDensity(value.vegetationDensity),
  };
}

function createFoliageMaterial(color, roughness = 0.94) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    flatShading: true,
  });
}

function addInstancedLayer(parent, name, geometry, material, entries) {
  if (entries.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  entries.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

function composeMatrix(position, scale, rotationY = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    new THREE.Vector3(...scale),
  );
}

function createBushEntries(density) {
  const layers = [[], [], [], []];
  const countPerSide = Math.ceil(((ROAD_START_Z - ROAD_END_Z) / BUSH_INTERVAL) * density);
  for (let index = 0; index < countPerSide; index += 1) {
    const z = ROAD_START_Z - index * BUSH_INTERVAL + (seeded(index, 4) - 0.5) * 8;
    const scale = 0.72 + seeded(index, 5) * 0.54;
    for (const side of [-1, 1]) {
      const x = side * THREE.MathUtils.lerp(BUSH_SIDE_MIN, BUSH_SIDE_MAX, seeded(index, side * 7 + 11));
      const rotation = seeded(index, side * 17 + 3) * Math.PI;
      const sway = (seeded(index, side * 23 + 6) - 0.5) * 0.22;
      layers[0].push(composeMatrix([x, 0.8 * scale, z], [1.35 * scale, 1.05 * scale, 1.16 * scale], rotation));
      layers[1].push(composeMatrix([x - side * 0.42 * scale, 1.12 * scale, z + sway], [0.92 * scale, 0.96 * scale, 0.88 * scale], rotation + 0.4));
      layers[2].push(composeMatrix([x + side * 0.46 * scale, 1.2 * scale, z - sway], [0.84 * scale, 1.02 * scale, 0.86 * scale], rotation + 1.1));
      layers[3].push(composeMatrix([x, 1.74 * scale, z], [0.56 * scale, 0.63 * scale, 0.58 * scale], rotation + 1.8));
    }
  }
  return layers;
}

function createTreeEntries(density) {
  const trunkEntries = [];
  const crownLayers = [[], [], [], []];
  const countPerSide = Math.ceil(((ROAD_START_Z - ROAD_END_Z) / TREE_INTERVAL) * density);
  for (let index = 0; index < countPerSide; index += 1) {
    const z = ROAD_START_Z - index * TREE_INTERVAL + (seeded(index, 29) - 0.5) * 18;
    const scale = 0.88 + seeded(index, 31) * 0.36;
    for (const side of [-1, 1]) {
      const x = side * THREE.MathUtils.lerp(TREE_SIDE_MIN, TREE_SIDE_MAX, seeded(index, side * 37 + 41));
      const rotation = seeded(index, side * 43 + 13) * Math.PI;
      const height = 0.9 + seeded(index, side * 47 + 17) * 0.3;
      trunkEntries.push(composeMatrix([x, 2.25 * scale * height, z], [0.42 * scale, 4.5 * scale * height, 0.42 * scale], rotation));
      crownLayers[0].push(composeMatrix([x, 5.15 * scale * height, z], [1.95 * scale, 1.7 * scale, 1.85 * scale], rotation));
      crownLayers[1].push(composeMatrix([x - side * 0.9 * scale, 5.85 * scale * height, z + 0.12], [1.55 * scale, 1.55 * scale, 1.5 * scale], rotation + 0.5));
      crownLayers[2].push(composeMatrix([x + side * 0.95 * scale, 6.05 * scale * height, z - 0.14], [1.35 * scale, 1.45 * scale, 1.3 * scale], rotation + 1.2));
      crownLayers[3].push(composeMatrix([x, 6.78 * scale * height, z], [0.98 * scale, 1.18 * scale, 0.94 * scale], rotation + 1.8));
    }
  }
  return { trunkEntries, crownLayers };
}

function disposeChildren(root) {
  root.children.forEach((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose();
  });
  root.clear();
}

export function createTrackOneVegetation(parent, initialSettings = DEFAULT_VEGETATION_SETTINGS) {
  const root = new THREE.Group();
  root.name = 'track-one-realistic-vegetation';
  const bushesRoot = new THREE.Group();
  bushesRoot.name = 'track-one-bushes';
  const treesRoot = new THREE.Group();
  treesRoot.name = 'track-one-trees';
  root.add(bushesRoot, treesRoot);
  parent.add(root);

  let settings = normalizeVegetationSettings(initialSettings);
  let stats = { bushes: 0, trees: 0, bushLayers: 0, treeLayers: 0 };

  function rebuild(nextSettings = settings) {
    settings = normalizeVegetationSettings(nextSettings);
    disposeChildren(bushesRoot);
    disposeChildren(treesRoot);
    const density = settings.vegetationDensity;
    const bushGeometry = new THREE.IcosahedronGeometry(1, 1);
    const treeFoliageGeometry = new THREE.IcosahedronGeometry(1, 2);
    const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
    const bushLayers = createBushEntries(density);
    const treeEntries = createTreeEntries(density);
    const bushMaterials = [
      createFoliageMaterial(0x173f21),
      createFoliageMaterial(0x286b32),
      createFoliageMaterial(0x3f8a3d),
      createFoliageMaterial(0x75a942),
    ];
    const treeMaterials = [
      createFoliageMaterial(0x12391e),
      createFoliageMaterial(0x1f5d2b),
      createFoliageMaterial(0x347c35),
      createFoliageMaterial(0x5b9a3b),
    ];
    bushLayers.forEach((entries, index) => addInstancedLayer(bushesRoot, `bush-foliage-layer-${index}`, bushGeometry, bushMaterials[index], entries));
    addInstancedLayer(treesRoot, 'tree-trunks', trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.98, metalness: 0 }), treeEntries.trunkEntries);
    treeEntries.crownLayers.forEach((entries, index) => addInstancedLayer(treesRoot, `tree-crown-layer-${index}`, treeFoliageGeometry, treeMaterials[index], entries));
    stats = {
      bushes: bushLayers[0].length,
      trees: treeEntries.trunkEntries.length,
      bushLayers: bushLayers.length,
      treeLayers: treeEntries.crownLayers.length + 1,
    };
    applyVisibility();
    return stats;
  }

  function applyVisibility() {
    root.visible = settings.vegetationEnabled;
    bushesRoot.visible = settings.vegetationEnabled && settings.bushesEnabled;
    treesRoot.visible = settings.vegetationEnabled && settings.treesEnabled;
  }

  function update(nextSettings) {
    const next = normalizeVegetationSettings(nextSettings);
    if (next.vegetationDensity !== settings.vegetationDensity) rebuild(next);
    else {
      settings = next;
      applyVisibility();
    }
    return stats;
  }

  rebuild(settings);
  return {
    root,
    bushesRoot,
    treesRoot,
    rebuild,
    update,
    get settings() { return { ...settings }; },
    getStats: () => ({ ...stats }),
  };
}
