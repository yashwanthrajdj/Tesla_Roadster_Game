import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The test bridge is injected only into this browser's response. No debug API
// or teleport controls are shipped with the game.
const label = process.argv[2] ?? 'after';
await mkdir('artifacts', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  console.log('Browser launched');
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace('requestAnimationFrame(animate);', 'if (!window.__pauseRendering) requestAnimationFrame(animate);');
    if (label.startsWith('inventory')) body = body.replace('\nanimate();', '\n// Scene inventory without GPU compilation.');
    await route.fulfill({ response, body: `${body}\nwindow.__gameTest = {
      scene, renderer, physics, keys, vehicleRoot, effects, airReleasePools,
      vehicleLights, streetLighting,
      resetRun, updatePhysics, updateEffects, updateCamera, setTrackMode,
      setCameraAngle, applyTheme, getVehicleSupportOffset,
      ready: () => !!activeModel,
      stop: () => { paused = true; },
      resume: () => { paused = false; },
      step: (dt) => { updatePhysics(dt); updateEffects(dt); updateCamera(dt); },
      render: () => {
        streetLighting.update(activeTrack, physics.position, theme === 'day');
        vehicleLights.update(input.drive < 0 && physics.velocity.dot(tmp.forward) > 1);
        updateCamera(1);
        renderer.render(scene, activeTrack === 2 && cameraAngle === 'stunt-side' ? sideCamera : camera);
      },
      car: () => activeCar,
    };` });
  });
  await page.goto('http://127.0.0.1:5175/?quality=balanced', { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('Page opened');
  await page.waitForFunction(() => window.__gameTest?.ready(), null, { timeout: 120000 });
  console.log('Model loaded');
  const metrics = await page.evaluate(async (label) => {
    const game = window.__gameTest;
    game.stop();
    // Warm shaders and textures, then measure three equal stationary samples.
    const batches = [];
    for (let batch = -1; !label.startsWith('inventory') && batch < 3; batch++) {
      const frames = [];
      let previous = performance.now();
      for (let frame = 0; frame < 5; frame++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
      }
      if (batch >= 0) batches.push(frames.sort((a, b) => a - b)[2]);
    }
    let lights = 0, meshes = 0, sceneTriangles = 0;
    const lamps = [];
    game.scene.updateMatrixWorld(true);
    game.scene.traverseVisible((node) => {
      if (node.isLight) lights++;
      if (node.isMesh) {
        meshes++;
        sceneTriangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
        if (/headlight|rear.lights/i.test(node.name)) lamps.push({ name: node.name, matrix: node.matrixWorld.elements });
      }
    });
    return { medianFrameMs: batches, lights, meshes, drawCalls: game.renderer.info.render.calls,
      triangles: game.renderer.info.render.triangles, geometries: game.renderer.info.memory.geometries,
      pixelRatio: game.renderer.getPixelRatio(), model: game.car(), sceneTriangles, lamps };
  }, label);
  await page.screenshot({ path: `artifacts/${label}-road.png` });
  console.log(JSON.stringify({ label, metrics, errors }, null, 2));
  await writeFile(`artifacts/${label}-metrics.json`, JSON.stringify({ metrics, errors }, null, 2));
  if (!label.startsWith('inventory')) {
    await page.evaluate(() => { window.__pauseRendering = true; });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#car-select').inputValue(), '2020');
    const anchors = await page.evaluate(() => window.__gameTest.vehicleLights.headlights.map((light) => ({
      position: light.position.toArray(), target: light.target.position.toArray(), intensity: light.intensity,
    })));
    assert.ok(anchors.every((light) => light.position[2] < -1.7 && light.target[2] < light.position[2] && light.intensity > 0));
    await page.keyboard.press('l');
    assert.equal(await page.locator('#headlights-button').getAttribute('aria-pressed'), 'false');
    assert.ok(await page.evaluate(() => window.__gameTest.vehicleLights.headlights.every((light) => light.intensity === 0)));
    await page.evaluate(() => window.__gameTest.render());
    await page.screenshot({ path: 'artifacts/headlights-off.png' });
    await page.locator('#headlights-button').click();
    assert.equal(await page.locator('#headlights-button').getAttribute('aria-pressed'), 'true');
    for (const z of [-2000, -4880]) {
      const distance = await page.evaluate((z) => {
        const game = window.__gameTest;
        game.physics.position.z = z;
        game.streetLighting.update(1, game.physics.position, false);
        return Math.max(...game.streetLighting.spots.map((light) => Math.abs(light.position.z - z)));
      }, z);
      assert.ok(distance < 64, 'Street lighting must follow the car to the end of the road');
    }
    await page.evaluate(() => { const g = window.__gameTest; g.resetRun(false); g.resume(); });
    await page.keyboard.down('Space');
    const launch = await page.evaluate(() => {
      const g = window.__gameTest, initial = g.physics.position.y;
      for (let i = 0; i < 75; i++) g.step(1 / 60);
      g.render();
      return { rise: g.physics.position.y - initial, contact: g.physics.wheelContact,
        smoke: g.airReleasePools.find((pool) => pool.name === 'lift').particles.filter((p) => p.active).length };
    });
    assert.ok(launch.rise > 2 && !launch.contact, `Space takeoff failed: ${JSON.stringify(launch)}`);
    assert.ok(launch.smoke > 100, `Lift smoke missing: ${launch.smoke}`);
    await page.screenshot({ path: 'artifacts/lift-smoke.png' });
    await page.evaluate(() => { const g = window.__gameTest; g.setCameraAngle('left'); g.render(); });
    await page.screenshot({ path: 'artifacts/lift-smoke-side.png' });
    await page.keyboard.up('Space');
    const landing = await page.evaluate(() => {
      const g = window.__gameTest;
      for (let i = 0; i < 600 && !g.physics.wheelContact; i++) g.step(1 / 60);
      return { contact: g.physics.wheelContact, y: g.physics.position.y };
    });
    assert.ok(landing.contact && landing.y > 0, 'The lift test must end in a supported landing');
    await page.evaluate(() => {
      const g = window.__gameTest;
      g.setTrackMode(2); g.setCameraAngle('stunt-side'); g.render();
    });
    await page.screenshot({ path: 'artifacts/stunt-lighting.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (let i = 0; i < 3; i++) await page.locator('#quality-button').click();
    await page.locator('#headlights-button').click();
    assert.equal(await page.locator('#headlights-button').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { const g = window.__gameTest; g.setTrackMode(1); g.render(); });
    await page.screenshot({ path: 'artifacts/mobile-controls.png' });
    assert.ok(await page.evaluate(() => window.__gameTest.renderer.getPixelRatio() <= 0.8));
    await page.locator('.touch-controls').waitFor({ state: 'visible' });
    const liftButton = await page.getByRole('button', { name: 'Lift thrusters', exact: true }).boundingBox();
    await page.mouse.move(liftButton.x + liftButton.width / 2, liftButton.y + liftButton.height / 2);
    await page.mouse.down();
    assert.ok(await page.evaluate(() => window.__gameTest.keys.has('Space')));
    await page.mouse.up();
    assert.ok(await page.evaluate(() => !window.__gameTest.keys.has('Space')));
    console.log('Browser checks passed: default model, measured lamps, keyboard/button light toggle, distant lamps, Space takeoff, smoke, landing, track switch, Low quality and touch controls.');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser?.close();
  await server.close();
}
