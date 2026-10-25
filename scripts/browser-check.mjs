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
      scene, renderer, physics, input, settings, keys, vehicleRoot, effects, airReleasePools,
      vehicleLights, streetLighting,
      trackThreeRoot, stuntFormationRoot, stuntRoadSections, rebuildStuntFormation, updateTrackThreeRoad,
      resetRun, updatePhysics, updateEffects, updateCamera, setTrackMode,
      setCameraAngle, applyTheme, getVehicleSupportOffset, getTerrainInfo,
      ready: () => !!activeModel && !!smokeTexture.image?.width,
      stop: () => { paused = true; },
      resume: () => { paused = false; },
      step: (dt) => { updatePhysics(dt); updateEffects(dt); updateCamera(dt); },
      render: () => {
        streetLighting.update(activeTrack, physics.position, theme === 'day');
        vehicleLights.update(input.drive < 0 && physics.velocity.dot(tmp.forward) > 1);
        updateCamera(1);
        updateHUD(1 / 60);
        airReleasePools.forEach((pool) => pool.prepare(activeTrack === 2 && cameraAngle === 'stunt-side' ? sideCamera : camera));
        renderer.render(scene, activeTrack === 2 && cameraAngle === 'stunt-side' ? sideCamera : camera);
      },
      car: () => activeCar,
    };` });
  });
  await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('Page opened');
  await page.waitForFunction(() => window.__gameTest?.ready(), null, { timeout: 120000 });
  console.log('Model loaded');
  await page.waitForTimeout(5900);
  assert.ok(await page.locator('#loading-screen').evaluate((element) => element.classList.contains('hidden')));
  assert.match(await page.locator('#loading-video').evaluate((video) => video.currentSrc), /roadster-loading\.mp4$/);
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
    await page.locator('#settings-button').click();
    await page.locator('#settings-overlay.open').waitFor();
    await page.screenshot({ path: 'artifacts/settings-page.png' });
    await page.locator('#steering-sensitivity').fill('1.55');
    await page.locator('#auto-thrust').check();
    await page.locator('#close-settings-button').click();
    await page.locator('#settings-overlay.open').waitFor({ state: 'hidden' });
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('#steering-sensitivity').inputValue(), '1.55');
    assert.equal(await page.locator('#auto-thrust').isChecked(), true);
    await page.locator('#auto-thrust').uncheck();
    await page.locator('#close-settings-button').click();
    assert.equal(await page.locator('#quality-button').count(), 0);
    assert.equal(await page.evaluate(() => window.__gameTest.renderer.getPixelRatio()), 1);
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
    await page.keyboard.down('ArrowUp');
    const driving = await page.evaluate(() => {
      const g = window.__gameTest;
      for (let i = 0; i < 30; i++) g.step(1 / 60);
      return { z: g.physics.position.z, drive: g.input.drive, rear: g.input.rear, air: g.physics.air };
    });
    assert.ok(driving.z < 45 && driving.drive === 1 && driving.rear === 0 && driving.air === 100);
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => window.__gameTest.resetRun(false));
    await page.keyboard.down('w');
    const thrust = await page.evaluate(() => {
      const g = window.__gameTest;
      for (let i = 0; i < 30; i++) g.step(1 / 60);
      g.render();
      return { z: g.physics.position.z, drive: g.input.drive, rear: g.input.rear, air: g.physics.air };
    });
    assert.ok(thrust.z < 45 && thrust.drive === 0 && thrust.rear === 1 && thrust.air < 100);
    await page.screenshot({ path: 'artifacts/rear-smoke.png' });
    await page.keyboard.up('w');
    await page.evaluate(() => window.__gameTest.resetRun(false));
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
    await page.evaluate(() => window.__gameTest.resetRun(false));
    await page.keyboard.down('s');
    assert.ok(await page.evaluate(() => {
      const g = window.__gameTest;
      for (let i = 0; i < 60; i++) g.step(1 / 60);
      return g.input.lift === 1 && !g.physics.wheelContact && g.physics.position.y > 2;
    }), 'S must lift on the road, not reverse');
    await page.keyboard.up('s');
    for (const code of ['q', 'e']) {
      await page.evaluate(() => { const g = window.__gameTest; g.setTrackMode(2); g.resume(); });
      await page.keyboard.down('ArrowUp');
      const exit = await page.evaluate(() => {
        const g = window.__gameTest;
        let inverted = false;
        for (let frame = 0; frame < 900; frame++) {
          g.step(1 / 60);
          const q = g.physics.quaternion;
          const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
          inverted ||= upY < -0.8;
          if (inverted && !g.physics.wheelContact && g.physics.position.z > -31) {
            return { inverted, upY, y: g.physics.position.y };
          }
        }
        return { inverted, contact: g.physics.wheelContact, position: g.physics.position.toArray() };
      });
      await page.keyboard.up('ArrowUp');
      assert.ok(exit.inverted && exit.upY < -0.8 && exit.y > 15, `Did not reproduce inverted ramp exit: ${JSON.stringify(exit)}`);
      await page.keyboard.down(code);
      const recovery = await page.evaluate(() => {
        const g = window.__gameTest;
        for (let i = 0; i < 70; i++) g.step(1 / 60);
        g.setCameraAngle('left'); g.render();
        const q = g.physics.quaternion;
        return { upY: 1 - 2 * (q.x * q.x + q.z * q.z), active: g.physics.spinActive, y: g.physics.position.y };
      });
      assert.ok(recovery.upY > 0.999 && !recovery.active && recovery.y > 5, `${code} failed wheels-down recovery: ${JSON.stringify(recovery)}`);
      await page.keyboard.down(code); // OS repeat while held must not start another spin.
      assert.ok(await page.evaluate(() => !window.__gameTest.physics.spinActive));
      await page.keyboard.up(code);
      await page.screenshot({ path: `artifacts/ramp-${code}-recovery.png` });
      assert.ok(await page.evaluate(() => {
        const g = window.__gameTest;
        for (let i = 0; i < 600 && !g.physics.wheelContact; i++) g.step(1 / 60);
        const q = g.physics.quaternion;
        return g.physics.wheelContact && g.physics.position.y > 0 && 1 - 2 * (q.x * q.x + q.z * q.z) > 0.99;
      }), `${code} recovery must finish with a wheels-down landing`);
    }
    await page.evaluate(() => {
      const g = window.__gameTest;
      g.setTrackMode(2); g.setCameraAngle('stunt-side'); g.render();
    });
    await page.screenshot({ path: 'artifacts/stunt-lighting.png' });
    await page.evaluate(() => {
      const g = window.__gameTest;
      g.setTrackMode(3);
      g.updateTrackThreeRoad();
      g.setCameraAngle('rear');
      g.render();
    });
    assert.equal(await page.locator('#track-button').getAttribute('title'), 'Switch to Road 01');
    const stuntFormation = await page.evaluate(() => {
      const g = window.__gameTest;
      return {
        sections: g.stuntRoadSections.length,
        visible: g.trackThreeRoot.visible,
        targets: g.stuntFormationRoot.children.length,
        targetXs: g.stuntFormationRoot.children.map((target) => target.position.x),
        targetZs: g.stuntFormationRoot.children.map((target) => target.position.z),
      };
    });
    assert.equal(stuntFormation.sections, 7);
    assert.equal(stuntFormation.visible, true);
    assert.equal(stuntFormation.targets, 3);
    assert.ok(stuntFormation.targetXs.every((x) => x === -3));
    assert.ok(stuntFormation.targetZs[1] < stuntFormation.targetZs[0] && stuntFormation.targetZs[2] < stuntFormation.targetZs[1]);
    await page.locator('#settings-button').click();
    await page.locator('#settings-overlay.open').waitFor();
    await page.locator('#stunt-vehicle-count').fill('5');
    await page.locator('#stunt-vehicle-spacing').fill('3.5');
    const updatedFormation = await page.evaluate(() => {
      const g = window.__gameTest;
      return { targets: g.stuntFormationRoot.children.length, xs: g.stuntFormationRoot.children.map((target) => target.position.x), zs: g.stuntFormationRoot.children.map((target) => target.position.z) };
    });
    assert.equal(updatedFormation.targets, 5);
    assert.ok(updatedFormation.xs.every((x) => x === -3));
    assert.ok(Math.abs(updatedFormation.zs[1] - updatedFormation.zs[0] + (4.8 + 3.5)) < 1e-6);
    await page.locator('#close-settings-button').click();
    await page.locator('#settings-overlay.open').waitFor({ state: 'hidden' });
    const trackThreeSurface = await page.evaluate(() => {
      const g = window.__gameTest;
      const terrain = g.getTerrainInfo(-3, -108);
      return { type: terrain.type, name: terrain.name, height: terrain.height };
    });
    assert.equal(trackThreeSurface.type, 'ground');
    assert.equal(trackThreeSurface.name, 'SIX-LANE HIGHWAY');
    assert.equal(trackThreeSurface.height, -0.04);
    await page.screenshot({ path: 'artifacts/stunt-jump-track3.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.locator('#headlights-button').click();
    assert.equal(await page.locator('#headlights-button').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { const g = window.__gameTest; g.setTrackMode(1); g.render(); });
    await page.screenshot({ path: 'artifacts/mobile-controls.png' });
    assert.equal(await page.evaluate(() => window.__gameTest.renderer.getPixelRatio()), 2);
    assert.equal(await page.evaluate(() => document.querySelector('canvas').width), 780);
    await page.locator('.touch-controls').waitFor({ state: 'visible' });
    const liftButton = await page.getByRole('button', { name: 'Lift thrusters', exact: true }).boundingBox();
    await page.mouse.move(liftButton.x + liftButton.width / 2, liftButton.y + liftButton.height / 2);
    await page.mouse.down();
    assert.ok(await page.evaluate(() => window.__gameTest.keys.has('Space')));
    await page.mouse.up();
    assert.ok(await page.evaluate(() => !window.__gameTest.keys.has('Space')));
    console.log('Browser checks passed: lights, arrow driving, WASD thrusters, Space/S takeoff, cloud smoke, landing, actual inverted ramp Q/E recovery, native DPR and touch controls.');
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await browser?.close();
  await server.close();
}
