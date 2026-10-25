import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Camera-facing textured cloud quads. Unlike GL points these have no hardware
// point-size cap, and can stretch along a pressure stream without square edges.
export function createPressureSmoke(parent, name, capacity, texture = null) {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const axes = new Float32Array(capacity * 3);
  const stretches = new Float32Array(capacity);
  const rotations = new Float32Array(capacity);
  const tiles = new Float32Array(capacity);
  const floors = new Float32Array(capacity);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  for (const [attribute, array, count] of [
    ['cloudPosition', positions, 3], ['size', sizes, 1], ['alpha', alphas, 1],
    ['axis', axes, 3], ['stretch', stretches, 1], ['rotation', rotations, 1],
    ['tile', tiles, 1], ['floorY', floors, 1],
  ]) geometry.setAttribute(attribute, new THREE.InstancedBufferAttribute(array, count).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    uniforms: { cloudMap: { value: texture } },
    vertexShader: `
      attribute vec3 cloudPosition;
      attribute vec3 axis;
      attribute float size, alpha, stretch, rotation, tile, floorY;
      varying vec2 vUv;
      varying float vAlpha, vTile, vFloor, vWorldY;
      void main() {
        vec4 center = modelViewMatrix * vec4(cloudPosition, 1.0);
        vec2 flow = (modelViewMatrix * vec4(axis, 0.0)).xy;
        vec2 up = length(flow) > 0.01 ? normalize(flow) : vec2(0.0, 1.0);
        vec2 right = vec2(up.y, -up.x);
        float c = cos(rotation), s = sin(rotation);
        vec2 p = mat2(c, -s, s, c) * position.xy;
        vec2 offset = (right * p.x + up * p.y * stretch) * size;
        center.xy += offset;
        gl_Position = projectionMatrix * center;
        vWorldY = cloudPosition.y + viewMatrix[1][0] * offset.x + viewMatrix[1][1] * offset.y;
        vUv = uv; vTile = tile; vAlpha = alpha; vFloor = floorY;
      }`,
    fragmentShader: `
      uniform sampler2D cloudMap;
      varying vec2 vUv;
      varying float vAlpha, vTile, vFloor, vWorldY;
      void main() {
        vec2 atlasUv = vec2((clamp(vUv.x, 0.002, 0.998) + vTile) * 0.25, vUv.y);
        vec4 cloud = texture2D(cloudMap, atlasUv);
        float alpha = cloud.a * vAlpha * smoothstep(vFloor + 0.015, vFloor + 0.2, vWorldY);
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(cloud.rgb * vec3(0.95, 0.97, 1.0), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name}-pressure-clouds`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  parent.add(mesh);
  const particles = Array.from({ length: capacity }, (_, index) => ({ index, active: false, life: 0,
    maxLife: 1, size: 0, alpha: 0, grounded: false, seed: index * 2.39996, floor: 0,
    rotation: 0, tile: index % 4, position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    axis: new THREE.Vector3(0, -1, 0) }));
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(), sideways = new THREE.Vector3();
  const active = [];
  let next = 0;

  function upload(camera) {
    active.length = 0;
    for (const p of particles) if (p.active) active.push(p);
    if (camera) {
      camera.updateMatrixWorld();
      const m = camera.matrixWorldInverse.elements;
      // Pack back-to-front within each stream for stable transparent blending.
      active.sort((a, b) => (m[2] * a.position.x + m[6] * a.position.y + m[10] * a.position.z)
        - (m[2] * b.position.x + m[6] * b.position.y + m[10] * b.position.z));
    }
    active.forEach((p, i) => {
      const age = 1 - p.life / p.maxLife;
      p.position.toArray(positions, i * 3); p.axis.toArray(axes, i * 3);
      sizes[i] = p.size + (p.grounded ? 3.6 : 2.4) * age;
      stretches[i] = p.grounded ? 0.8 : 1 + 1.6 * Math.exp(-age * 8);
      alphas[i] = p.alpha * Math.min(1, age * 35) * (1 - age) ** 1.5;
      rotations[i] = p.rotation + (p.grounded ? age * 0.3 : age * 0.12);
      tiles[i] = p.tile; floors[i] = p.floor;
    });
    geometry.instanceCount = active.length;
    for (const attr of ['cloudPosition', 'size', 'alpha', 'axis', 'stretch', 'rotation', 'tile', 'floorY']) {
      geometry.attributes[attr].needsUpdate = true;
    }
  }

  return {
    name, capacity, geometry, mesh, positions, sizes, alphas, particles, spawnAccumulator: 0, nextJet: 0,
    prepare: upload,
    emit(jet, pressure, physics, boost = false, ageOffset = 0) {
      if (pressure < 0.025) return;
      const p = particles[next]; next = (next + 1) % capacity;
      p.active = true; p.grounded = false;
      p.maxLife = (name === 'lift' ? 2.1 : 1.4) + Math.random() * 0.45;
      p.life = p.maxLife - ageOffset;
      p.size = 0.5 + Math.random() * 0.25;
      p.alpha = 0.32 + pressure * 0.28;
      p.rotation = (Math.random() - 0.5) * 0.55;
      origin.copy(jet.group.position).applyQuaternion(physics.quaternion).add(physics.position);
      direction.copy(jet.direction).applyQuaternion(physics.quaternion).normalize();
      p.axis.copy(direction);
      p.position.copy(origin).addScaledVector(physics.velocity, -ageOffset).addScaledVector(direction, 0.05);
      p.velocity.copy(physics.velocity).addScaledVector(direction, (name === 'lift' ? 18 : 22) * pressure * (boost ? 1.4 : 1));
      p.position.addScaledVector(p.velocity, ageOffset);
      sideways.crossVectors(direction, UP);
      if (sideways.lengthSq() < 0.01) sideways.set(1, 0, 0);
      sideways.normalize();
      p.velocity.addScaledVector(sideways, (Math.random() - 0.5) * 0.8);
    },
    clear() {
      particles.forEach((p) => { p.active = false; });
      sizes.fill(0); alphas.fill(0); geometry.instanceCount = 0;
      this.spawnAccumulator = 0; next = 0; upload();
    },
    update(dt, groundHeight) {
      for (const p of particles) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        const age = 1 - p.life / p.maxLife;
        p.velocity.multiplyScalar(Math.exp(-(p.grounded ? 1.15 : 0.8) * dt));
        p.velocity.x += Math.sin(p.seed + age * 7) * age * dt * 2;
        p.velocity.z += Math.cos(p.seed + age * 6) * age * dt * 2;
        p.velocity.y += age * dt * 1.3;
        p.position.addScaledVector(p.velocity, dt);
        p.floor = groundHeight(p.position.x, p.position.z);
        if (p.position.y < p.floor + 0.2) {
          p.position.y = p.floor + 0.2;
          if (!p.grounded) {
            p.velocity.x += Math.cos(p.seed) * 4.5;
            p.velocity.z += Math.sin(p.seed) * 4.5;
            p.velocity.y = 0.6; p.grounded = true;
            p.axis.copy(UP); p.rotation = p.seed;
            p.size = Math.max(p.size, 1.1);
          }
        }
      }
      upload();
    },
  };
}
