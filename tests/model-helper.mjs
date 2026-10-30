import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

// Load the real asset's geometry/materials in Node, omitting image decoding
// only. All node transforms and lamp vertices are retained for regression tests.
export async function loadModel(file) {
  const data = await readFile(new URL(`../public/models/${file}`, import.meta.url));
  let doc, binary;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) doc = JSON.parse(chunk.toString());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  function stripTextures(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (/texture$/i.test(key)) delete value[key];
      else stripTextures(value[key]);
    }
  }
  stripTextures(doc.materials);
  doc.images = []; doc.textures = [];
  doc.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  scene.scale.setScalar(4.65 / Math.max(size.x, size.z));
  scene.rotation.y = Math.PI;
  const center = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3());
  scene.position.y = -center.y;
  scene.updateMatrixWorld(true);
  return scene;
}

export async function loadRawModel(file) {
  const data = await readFile(new URL(`../public/models/${file}`, import.meta.url));
  let doc, binary;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) doc = JSON.parse(chunk.toString());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  function stripTextures(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (/texture$/i.test(key)) delete value[key];
      else stripTextures(value[key]);
    }
  }
  stripTextures(doc.materials);
  doc.images = []; doc.textures = [];
  doc.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(doc), '');
  return scene;
}
