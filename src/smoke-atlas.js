// Bake four views through a turbulent 3D density field. This work runs in the
// asset generator, not in a per-pixel raymarch on the player's GPU.
const smooth = (x) => x * x * (3 - 2 * x);
const mix = (a, b, t) => a + (b - a) * t;
function hash(x, y, z) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  return mix(
    mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), tx), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), tx), ty),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), tx), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), tx), ty), tz);
}
function density(x, y, z, seed) {
  const low = noise(x * 3 + seed, y * 3 - seed, z * 3 + seed);
  const detail = noise(x * 9 + seed, y * 9, z * 9) * 0.22 + noise(x * 22, y * 22 + seed, z * 22) * 0.08;
  // Domain-warped edges and several billows, not a round gradient disc.
  const radius = Math.hypot(x * 1.05, y * 0.94, z);
  return Math.max(0, (0.79 - radius + (low - 0.5) * 0.6) * 2.7) * (0.3 + low * 0.65 + detail);
}

export function createSmokeAtlasData(tileSize = 128) {
  const width = tileSize * 4, height = tileSize;
  const data = new Uint8Array(width * height * 4);
  for (let tile = 0; tile < 4; tile++) {
    const seed = 7 + tile * 19;
    for (let py = 0; py < tileSize; py++) {
      for (let px = 0; px < tileSize; px++) {
        const x = (px + 0.5) / tileSize * 2 - 1;
        const y = 1 - (py + 0.5) / tileSize * 2;
        let opacity = 0, luminance = 0;
        for (let step = 0; step < 28; step++) {
          const z = -1 + (step + 0.5) * 2 / 28;
          const d = density(x, y, z, seed);
          if (d <= 0) continue;
          const shade = density(x - 0.16, y + 0.24, z - 0.18, seed);
          const light = 0.46 + 0.5 * Math.exp(-shade * 2.1);
          const alpha = 1 - Math.exp(-d * 0.26);
          luminance += (1 - opacity) * alpha * light;
          opacity += (1 - opacity) * alpha;
        }
        const i = (py * width + tile * tileSize + px) * 4;
        const color = opacity > 0 ? Math.round(255 * luminance / opacity) : 180;
        data[i] = color; data[i + 1] = color; data[i + 2] = color;
        data[i + 3] = Math.round(opacity * 255);
      }
    }
  }
  return { data, width, height };
}
