// main.js — boot, the fixed-step loop, and the round state machine.
// The simulation runs at a fixed 60 Hz, apart from rendering: input is sampled
// into a plain object, simStep advances the world, and the render pass only
// draws the state. Nothing in the sim touches the DOM; the HUD reads state.
import * as THREE from 'three';
import { createState, resetRound, ROUND } from './state.js';
import { buildBank, findPath } from './bank.js';
import { WEAPONS, GRENADE, freshLoadout, buyWeapon, buyGrenade } from './weapons.js';
import { createPlayer, updatePlayer, EYE_STAND } from './player.js';
import { spawnBots, updateBot, resetBots } from './bots.js';
import { shoot, throwGrenade, updateGrenades, addTracer } from './combat.js';
import { createAudio } from './audio.js';
import { createHUD, updateHUD, drawRadar, showOverlay, showBanner, flashHitmarker } from './hud.js';

const SIM_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // lobby | vault | combat — staged screenshot mode

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141210);
scene.fog = new THREE.Fog(0x191512, 42, 100);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 120);

const state = createState();
const map = buildBank(scene);
const audio = createAudio();
const hud = createHUD();
const player = createPlayer(scene);
state.player = player;
const loadout = freshLoadout();
player.loadout = loadout;
state.bots = spawnBots(scene, map.spawns);
const input = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false, jump: false, fire: false, plant: false };

// --- tracers: one LineSegments, preallocated, reused every frame ---
const TRACER_MAX = 24;
const tracerGeo = new THREE.BufferGeometry();
const tracerPos = new Float32Array(TRACER_MAX * 6);
tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
const tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }));
tracerLines.frustumCulled = false;
scene.add(tracerLines);

// --- grenade meshes: a small pool, one mesh per live grenade ---
const grenadeMeshes = [];
{
  const g = new THREE.SphereGeometry(0.14, 10, 8);
  const m = new THREE.MeshLambertMaterial({ color: 0x2e4a2e });
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(g, m);
    mesh.visible = false;
    scene.add(mesh);
    grenadeMeshes.push(mesh);
  }
}
// --- the breaching charge on the vault door ---
const chargeMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.22), new THREE.MeshLambertMaterial({ color: 0x8a2a2a }));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe14b }));
  lamp.position.set(0.18, 0.12, 0.12);
  chargeMesh.add(box, lamp);
  chargeMesh.position.copy(state.charge.pos);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

// --- input ---
const KEYMAP = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', Space: 'jump', KeyE: 'plant' };
let locked = false;
addEventListener('keydown', (e) => {
  if (KEYMAP[e.code] !== undefined) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG') doThrowGrenade();
  if (e.code === 'KeyB' && state.phase === 'buy') hud.buyMenu.hidden = !hud.buyMenu.hidden;
  if (e.code.startsWith('Digit') && state.phase === 'buy') buyKey(e.code.slice(5));
  if (e.code === 'KeyM') { state.muted = !state.muted; audio.setMuted(state.muted); }
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code] !== undefined) input[KEYMAP[e.code]] = false; });
addEventListener('mousedown', (e) => {
  if (e.button === 0 && (locked || SHOT)) input.fire = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
addEventListener('mousemove', (e) => {
  if (!locked || !player.alive) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - e.movementY * 0.0021));
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !SHOT && (state.phase === 'live' || state.phase === 'buy' || state.phase === 'planted') && player.alive) {
    showOverlay(hud, 'Paused', 'Click to get back in the bank.', 'Resume');
  }
});
hud.playBtn.addEventListener('click', () => {
  audio.unlock();
  if (state.phase === 'menu') startMatch();
  else if (state.phase === 'over') location.reload();
  else { hud.overlay.hidden = true; renderer.domElement.requestPointerLock(); }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function startReload() {
  const w = WEAPONS[loadout.current];
  if (loadout.reloading > 0 || loadout.mag[w.id] >= w.mag || loadout.reserve[w.id] <= 0) return;
  loadout.reloading = w.reload;
  audio.reload();
}

function doThrowGrenade() {
  if (state.phase !== 'live' && state.phase !== 'planted') return;
  throwGrenade(state, player, loadout, audio);
}

function buyKey(n) {
  const items = ['p9', 'hornet', 'vk47', 'breacher', 'frag'];
  const id = items[Number(n) - 1];
  if (!id) return;
  let r;
  if (id === 'frag') r = buyGrenade(loadout, state.money);
  else r = buyWeapon(loadout, state.money, id);
  if (r.ok) { state.money = r.money; audio.buy(); }
  else audio.deny();
}

// --- rounds ---
function startMatch() {
  hud.overlay.hidden = true;
  renderer.domElement.requestPointerLock();
  state.score = { crew: 0, guard: 0 };
  state.round = 1;
  state.money = ROUND.startMoney;
  setupRound();
}

function setupRound() {
  resetRound(state);
  player.pos.set(-1, 0, 18);
  player.yaw = 0; player.pitch = 0;
  player.hp = 100; player.alive = true; player.stamina = 100;
  player.vel.set(0, 0, 0);
  const l = freshLoadout();
  // keep what the player already owns between rounds
  l.owned = loadout.owned; l.current = loadout.current;
  l.mag = { ...loadout.mag }; l.reserve = { ...loadout.reserve };
  l.grenades = 0;
  for (const k of Object.keys(l.mag)) {
    if (l.owned[k]) { l.mag[k] = WEAPONS[k].mag; l.reserve[k] = Math.max(l.reserve[k], WEAPONS[k].reserve); }
  }
  Object.assign(loadout, l);
  resetBots(state.bots, map.spawns, scene);
  map.vaultDoor.rotation.x = 0;
  map.vaultDoor.position.y = 1.9;
  state.phase = 'buy';
  showBanner(hud, `ROUND ${state.round} — plant the charge on the vault`, '#f0a830');
}

function endRound(winner, reason) {
  if (state.phase === 'over') return;
  state.score[winner] += 1;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.phase = 'over';
  const won = winner === 'crew';
  showBanner(hud, won ? `CREW TAKES ROUND ${state.round} — ${reason}` : `GUARDS HOLD ROUND ${state.round} — ${reason}`, won ? '#2fd4a7' : '#e14b4b');
  if (won) { state.money += ROUND.winBonus; audio.roundWin(); }
  else { state.money += ROUND.lossBonus; audio.roundLose(); }
  if (state.score[winner] >= ROUND.winScore) {
    state.matchWinner = winner;
    state.phase = 'over';
    setTimeout(() => {
      showOverlay(hud,
        won ? 'HEIST COMPLETE — the Crew cracks the vault' : 'HEIST FOILED — the Guards hold the bank',
        `Final score — Crew ${state.score.crew} : ${state.score.guard} Guard. The vault ${won ? 'is open' : 'stays shut'}.`,
        'Play again');
    }, 1800);
    return;
  }
  setTimeout(() => {
    state.round += 1;
    setupRound();
  }, 3500);
}

function aliveCount(team) {
  let n = team === 'crew' && player.alive ? 1 : 0;
  for (const b of state.bots) if (b.team === team && b.alive) n++;
  return n;
}

// --- the fixed-step simulation ---
function simStep(dt) {
  state.time += dt;
  state.roundTime += dt;
  if (state.phase !== 'buy' && state.phase !== 'live' && state.phase !== 'planted') return;

  if (state.phase === 'buy') {
    state.buyLeft -= dt;
    if (state.buyLeft <= 0) { state.phase = 'live'; showBanner(hud, 'GO — plant the charge on the vault door', '#f0a830'); }
  } else {
    state.timer -= dt;
  }

  // reload progress
  if (loadout.reloading > 0) {
    loadout.reloading -= dt;
    if (loadout.reloading <= 0) {
      const w = WEAPONS[loadout.current];
      const need = w.mag - loadout.mag[w.id];
      const take = Math.min(need, loadout.reserve[w.id]);
      loadout.mag[w.id] += take;
      loadout.reserve[w.id] -= take;
    }
  }
  loadout.spreadBloom = Math.max(0, loadout.spreadBloom - dt * 0.045);
  if (loadout.recoilPitch > 0) {
    const rec = Math.min(loadout.recoilPitch, dt * 0.055);
    loadout.recoilPitch -= rec;
    player.pitch = Math.max(-1.2, player.pitch - rec);
  }

  // the player fires while the trigger is held (auto weapons keep firing)
  if (input.fire && player.alive && (state.phase === 'live' || state.phase === 'planted')) {
    const w = WEAPONS[loadout.current];
    if (!w.auto && input.fire) {
      if (state.time - loadout.lastShot >= w.interval) {
        const before = loadout.mag[w.id];
        shoot(state, player, loadout, map.colliders, audio, onKill);
        if (loadout.mag[w.id] < before) flashHitmarker(hud);
      }
    } else if (w.auto) {
      const before = loadout.mag[w.id];
      shoot(state, player, loadout, map.colliders, audio, onKill);
      if (loadout.mag[w.id] < before) flashHitmarker(hud);
    }
  }

  updatePlayer(player, input, map.colliders, dt, audio);
  for (const b of state.bots) updateBot(state, b, map.colliders, map, dt, audio, onKill);
  updateGrenades(state, map.colliders, dt, audio, onKill);

  // --- plant / defuse: hold E near the vault door or the planted charge ---
  const c = state.charge;
  if (player.alive && input.plant) {
    if (c.state === 'none' && player.pos.distanceTo(map.plantSpot) < 2.4) {
      c.state = 'planting';
      c.progress += dt / ROUND.plantTime;
      if (Math.random() < dt * 3) audio.plantBeep();
      if (c.progress >= 1) {
        c.state = 'planted';
        c.fuse = ROUND.fuseTime;
        c.progress = 0;
        state.phase = 'planted';
        state.money += ROUND.plantBonus;
        audio.planted();
        showBanner(hud, 'CHARGE PLANTED — defend it for 30 seconds!', '#f0a830');
      }
    } else if (c.state === 'planted' && player.pos.distanceTo(map.plantSpot) < 2.4) {
      c.state = 'defusing';
      c.progress += dt / ROUND.defuseTime;
      if (Math.random() < dt * 3) audio.defuseBeep();
      if (c.progress >= 1) {
        c.state = 'defused';
        state.money += ROUND.defuseBonus;
        endRound('guard', 'charge defused');
      }
    }
  } else if (c.state === 'planting' || c.state === 'defusing') {
    // letting go of E drops the hold; a guard's defuse is separate (bots.js)
    if (c.state === 'planting') { c.state = 'none'; c.progress = 0; }
    else if (c.state === 'defusing') { c.state = 'planted'; c.progress = 0; }
  }

  // fuse countdown
  if (c.state === 'planted') {
    c.fuse -= dt;
    if (c.fuse <= 0) {
      c.state = 'detonated';
      audio.explosion();
      state.shake = 1;
      map.vaultDoor.rotation.x = -0.9;
      endRound('crew', 'vault breached');
    }
  }
  if (c.state === 'defused') { /* endRound already called */ }

  // decay noise and killfeed
  for (let i = state.noise.length - 1; i >= 0; i--) {
    state.noise[i].life -= dt;
    if (state.noise[i].life <= 0) state.noise.splice(i, 1);
  }
  for (let i = state.killfeed.length - 1; i >= 0; i--) {
    state.killfeed[i].life -= dt;
    if (state.killfeed[i].life <= 0) state.killfeed.splice(i, 1);
  }
  for (const t of state.tracers) t.life -= dt;
  state.tracers = state.tracers.filter((t) => t.life > 0);
  state.shake = Math.max(0, state.shake - dt * 1.4);

  // --- round end conditions ---
  if (state.phase === 'live' || state.phase === 'planted') {
    const crewAlive = aliveCount('crew');
    const guardAlive = aliveCount('guard');
    if (guardAlive === 0) endRound('crew', 'guards eliminated');
    else if (crewAlive === 0) endRound('guard', 'crew eliminated');
    else if (state.timer <= 0 && state.phase === 'live') endRound('guard', 'time expired — vault held');
  }
}

function onKill(target, attacker) {
  // the killfeed and bonuses live in combat.applyDamage; this hook is for the
  // round-end check, which simStep runs every tick.
}

// --- render ---
const _camPos = new THREE.Vector3();
function render() {
  // camera follows the player, with shake and recoil already in the pitch
  const shake = state.shake * 0.05;
  _camPos.set(
    player.pos.x + (Math.random() - 0.5) * shake,
    player.pos.y + player.eyeH + (Math.random() - 0.5) * shake,
    player.pos.z + (Math.random() - 0.5) * shake,
  );
  camera.position.copy(_camPos);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  // the viewmodel gun rides with the camera
  player.body.position.copy(_camPos);
  player.body.quaternion.copy(camera.quaternion);
  const kick = Math.max(0, state.time - loadout.lastShot) < 0.09 ? 0.06 : 0;
  player.gun.position.z = -0.45 + kick;
  player.gun.visible = player.alive;

  // tracers
  let n = 0;
  for (const t of state.tracers) {
    if (n >= TRACER_MAX) break;
    tracerPos[n * 6] = t.a.x; tracerPos[n * 6 + 1] = t.a.y; tracerPos[n * 6 + 2] = t.a.z;
    tracerPos[n * 6 + 3] = t.b.x; tracerPos[n * 6 + 4] = t.b.y; tracerPos[n * 6 + 5] = t.b.z;
    n++;
  }
  tracerGeo.setDrawRange(0, n * 2);
  tracerGeo.attributes.position.needsUpdate = true;

  // grenade meshes follow live grenades
  state.grenades.forEach((g, i) => {
    if (i < grenadeMeshes.length) {
      grenadeMeshes[i].visible = true;
      grenadeMeshes[i].position.copy(g.pos);
    }
  });
  for (let i = state.grenades.length; i < grenadeMeshes.length; i++) grenadeMeshes[i].visible = false;

  // charge lamp blinks while planted
  chargeMesh.visible = state.charge.state === 'planting' || state.charge.state === 'planted' || state.charge.state === 'defusing';
  if (chargeMesh.visible) chargeMesh.children[1].visible = Math.floor(performance.now() / 250) % 2 === 0;

  renderer.render(scene, camera);
}

// --- HUD at 10 Hz, radar at 15 Hz ---
let hudAcc = 1, radarAcc = 1;
function updateHudThrottled(dt) {
  hudAcc += dt; radarAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; updateHUD(hud, state, player, loadout); }
  if (radarAcc > 0.066) { radarAcc = 0; drawRadar(hud, state, player, map); }
}

// --- the loop ---
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!SHOT) {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) {
      simStep(SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
  }
  render();
  updateHudThrottled(dt);
}

// --- staged screenshot mode ---
function setupShot() {
  hud.overlay.hidden = true;
  audio.unlock();
  state.round = 2;
  state.score = { crew: 1, guard: 1 };
  state.money = 2350;
  state.kills = 4;
  resetBots(state.bots, map.spawns, scene);
  // staged shots are frozen: no sim runs, so the framing stays exactly as set.
  state.shotMode = SHOT;
  if (SHOT === 'lobby') {
    // buy phase in the lobby, vault corridor ahead, guards visible in the gaps
    state.phase = 'buy';
    state.buyLeft = 15;
    state.timer = 100;
    player.pos.set(0, 0, 19); player.yaw = 0; player.pitch = 0.01;
    player.hp = 100; player.stamina = 88;
    placeBot('guard-0', -6, -9, Math.PI); placeBot('guard-1', 6, -9, Math.PI);
    placeBot('crew-0', -5, 16, 0); placeBot('crew-1', 4, 17, 0);
  } else if (SHOT === 'vault') {
    // planting the charge on the vault door, a guard holding the antechamber
    state.phase = 'live';
    state.timer = 64;
    player.pos.set(0.5, 0, -3.5); player.yaw = 0; player.pitch = 0.02;
    player.hp = 76; player.stamina = 64;
    state.charge.state = 'planting';
    state.charge.progress = 0.6;
    loadout.mag.vk47 = 18; loadout.reserve.vk47 = 60; loadout.current = 'vk47';
    loadout.owned.vk47 = true;
    placeBot('guard-0', -6, -9, Math.PI + 0.3); placeBot('guard-1', 6, -9, Math.PI - 0.3);
    placeBot('crew-0', -4, -7, 0);
  } else { // combat
    // mid-firefight in the teller hall: a tracer in the air, one guard down the lane
    state.phase = 'live';
    state.timer = 47;
    player.pos.set(9, 0, 13.5); player.yaw = 0.91; player.pitch = 0.01;
    player.hp = 82; player.stamina = 61;
    loadout.mag.vk47 = 18; loadout.reserve.vk47 = 50; loadout.current = 'vk47';
    loadout.owned.vk47 = true;
    placeBot('guard-0', -2, 5, -2.23); placeBot('guard-1', 10, 5, 3.0);
    placeBot('guard-2', -16, 8.6, -1.76);
    placeBot('crew-0', 4, 16, 0);
    // a tracer across the hall so the shot reads as a firefight
    const a = new THREE.Vector3(9, 1.5, 13.5);
    const b = new THREE.Vector3(-2, 1.4, 5);
    addTracer(state, a, b);
    state.killfeed.unshift({ text: 'You ▸ Rook  ◉ headshot', color: '#2fd4a7', life: 5 });
    state.killfeed.unshift({ text: 'Sable ▸ Marlowe', color: '#e14b4b', life: 5 });
  }
  updateHUD(hud, state, player, loadout);
  drawRadar(hud, state, player, map);
  window.__shotReady = true;
}

function placeBot(id, x, z, yaw) {
  const b = state.bots.find((v) => v.id === id);
  if (!b) return;
  b.pos.set(x, 0, z);
  b.yaw = yaw;
  b.mode = 'hold';
  b.holdSpot = b.pos.clone();
  b.holdUntil = state.time + 999;
  b.mesh.position.set(x, 0, z);
  b.mesh.rotation.y = yaw;
}

// --- boot ---
if (SHOT) {
  setupShot();
} else {
  showOverlay(hud, 'VAULTBREAK', 'A bank-heist tactical FPS. Plant the charge on the vault door — or die defending it. Click to play.', 'Click to play');
}
updateHUD(hud, state, player, loadout);
drawRadar(hud, state, player, map);
requestAnimationFrame(frame);
