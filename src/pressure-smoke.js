import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Bounded world-space particles, three draw calls total. BufferAttribute must
// retain these arrays: Float32BufferAttribute copies them and hid the old smoke.
export function createPressureSmoke(parent, name, capacity) {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const seeds = Float32Array.from({ length: capacity }, (_, i) => i * 2.39996);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, uniforms: { viewportHeight: { value: 600 } },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      attribute float seed;
      uniform float viewportHeight;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        vAlpha = alpha; vSeed = seed;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        float perspective = projectionMatrix[2][3] == -1.0 ? max(0.1, -view.z) : 1.0;
        gl_PointSize = clamp(size * viewportHeight * projectionMatrix[1][1] * 0.5 / perspective, 1.0, 96.0);
        if (alpha <= 0.0) gl_PointSize = 0.0;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      varying float vAlpha;
      varying float vSeed;
      void main() {
        if (vAlpha <= 0.0) discard;
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vSeed), s = sin(vSeed);
        p = mat2(c, -s, s, c) * p;
        float edge = 1.0 - smoothstep(0.1, 0.5, length(p));
        float billow = 0.72 + 0.1 * sin(p.x * 19.0 + vSeed) * cos(p.y * 23.0 - vSeed);
        float alpha = edge * billow * vAlpha;
        if (alpha < 0.008) discard;
        vec3 smoke = mix(vec3(0.49, 0.51, 0.52), vec3(0.94, 0.94, 0.91), edge);
        gl_FragColor = vec4(smoke, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = `${name}-pressure-smoke`;
  points.frustumCulled = false;
  points.renderOrder = 3;
  parent.add(points);
  const particles = Array.from({ length: capacity }, (_, index) => ({ index, active: false, life: 0,
    maxLife: 1, size: 0, alpha: 0, grounded: false, seed: seeds[index],
    position: new THREE.Vector3(), velocity: new THREE.Vector3() }));
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(), sideways = new THREE.Vector3();
  let next = 0;
  return {
    name, capacity, geometry, points, positions, sizes, alphas, particles, spawnAccumulator: 0, nextJet: 0,
    emit(jet, pressure, physics, boost = false) {
      if (pressure < 0.025) return;
      const particle = particles[next]; next = (next + 1) % capacity;
      particle.active = true; particle.grounded = false;
      particle.maxLife = (name === 'lift' ? 1.55 : 1.15) + Math.random() * 0.55;
      particle.life = particle.maxLife;
      particle.size = 0.24 + Math.random() * 0.12;
      particle.alpha = 0.55 + pressure * 0.4;
      origin.copy(jet.group.position).applyQuaternion(physics.quaternion).add(physics.position);
      direction.copy(jet.direction).applyQuaternion(physics.quaternion).normalize();
      particle.position.copy(origin).addScaledVector(direction, 0.06);
      particle.velocity.copy(physics.velocity).addScaledVector(direction, (name === 'lift' ? 24 : 20) * pressure * (boost ? 1.45 : 1));
      sideways.crossVectors(direction, UP);
      if (sideways.lengthSq() < 0.01) sideways.set(1, 0, 0);
      sideways.normalize();
      particle.velocity.addScaledVector(sideways, (Math.random() - 0.5) * 0.65);
    },
    clear() {
      particles.forEach((p) => { p.active = false; });
      sizes.fill(0); alphas.fill(0);
      geometry.attributes.size.needsUpdate = true; geometry.attributes.alpha.needsUpdate = true;
      this.spawnAccumulator = 0; next = 0;
    },
    update(dt, groundHeight, viewportHeight) {
      material.uniforms.viewportHeight.value = viewportHeight;
      for (const p of particles) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; sizes[p.index] = 0; alphas[p.index] = 0; continue; }
        const age = 1 - p.life / p.maxLife;
        p.velocity.multiplyScalar(Math.exp(-(p.grounded ? 1.5 : 0.9) * dt));
        p.velocity.x += Math.sin(p.seed + age * 9) * age * dt * 1.4;
        p.velocity.z += Math.cos(p.seed + age * 8) * age * dt * 1.4;
        p.velocity.y += age * dt * 1.3;
        p.position.addScaledVector(p.velocity, dt);
        const ground = groundHeight(p.position.x, p.position.z) + 0.12;
        if (p.position.y < ground) {
          p.position.y = ground;
          if (!p.grounded) {
            p.velocity.x += Math.cos(p.seed) * 5;
            p.velocity.z += Math.sin(p.seed) * 5;
            p.velocity.y = 0.25; p.grounded = true;
          }
        }
        p.position.toArray(positions, p.index * 3);
        sizes[p.index] = p.size + (p.grounded ? 3.8 : 2.6) * age;
        alphas[p.index] = p.alpha * (1 - age) ** 1.4;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;
      geometry.attributes.alpha.needsUpdate = true;
    },
  };
}
