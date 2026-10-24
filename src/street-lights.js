import * as THREE from 'three';

export function createStreetLighting(scene) {
  const locations = { 1: [], 2: [] };
  const spots = Array.from({ length: 4 }, (_, index) => {
    const spot = new THREE.SpotLight(0xffe4b6, 1000, 46, 1.08, 0.75, 2);
    spot.name = `pooled-streetlight-${index}`;
    scene.add(spot, spot.target);
    return spot;
  });
  const pools = [];
  let lastBay = null;
  let lastTheme = null;
  return {
    locations, spots,
    register(track, x, y, z) { locations[track].push(new THREE.Vector3(x, y, z)); },
    buildPools(track, parent) {
      // Cheap distant illumination is supplemented by actual nearby lights.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,239,199,0.6)');
      gradient.addColorStop(0.45, 'rgba(255,231,186,0.25)');
      gradient.addColorStop(1, 'rgba(255,231,186,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.26, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, locations[track].length);
      mesh.name = 'streetlight-road-pools';
      const dummy = new THREE.Object3D();
      locations[track].forEach((point, i) => {
        dummy.position.set(Math.sign(point.x) * 7, 0.065, point.z);
        dummy.rotation.x = -Math.PI / 2;
        dummy.scale.set(17, 34, 1);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.computeBoundingSphere();
      parent.add(mesh); pools.push(material);
    },
    update(track, position, day) {
      const bay = `${track}/${Math.round(position.z / 8)}/${Math.round(position.x / 6)}`;
      if (lastBay !== bay) {
        const nearest = locations[track].map((point) => ({ point,
          distance: (position.z - point.z) ** 2 + (position.x - point.x) ** 2 })).sort((a, b) => a.distance - b.distance);
        spots.forEach((spot, i) => {
          const point = nearest[i]?.point;
          if (!point) return;
          spot.position.copy(point);
          spot.target.position.set(Math.sign(point.x) * 5, -0.04, point.z);
        });
        lastBay = bay;
      }
      if (lastTheme !== day) {
        spots.forEach((spot) => { spot.intensity = day ? 0 : 1100; });
        pools.forEach((material) => { material.opacity = day ? 0.025 : 0.26; });
        lastTheme = day;
      }
    },
  };
}
