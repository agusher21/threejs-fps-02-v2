// bots.js — the bot fighters: a capsule body with a head, a team colour, and a
// small state machine. Guards hold the vault and the lanes; the crew pushes with
// the player. Bots patrol waypoints, investigate gunfire they hear, engage what
// they see with aimed bursts, and converge on the charge when it is planted.
import * as THREE from 'three';
import { findPath, collideCircle, hasLOS } from './bank.js';
import { WEAPONS, freshLoadout } from './weapons.js';
import { shoot, canSee } from './combat.js';

const BOT_NAMES = {
  crew: ['Vex', 'Marlowe', 'Duchess'],
  guard: ['Warden', 'Sable', 'Rook', 'Bishop', 'Knight'],
};

export function makeBot(scene, id, name, team, spawn, weaponId) {
  const color = team === 'crew' ? 0x2fd4a7 : 0xe14b4b;
  const group = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: team === 'crew' ? 0x274b41 : 0x4b2727 });
  const accent = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 10), suit);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshLambertMaterial({ color: 0xd9b48f }));
  head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), accent);
  visor.position.set(0, 1.64, 0.2);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55), new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
  gun.position.set(0.22, 1.05, 0.3);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 6, 12), accent);
  band.rotation.x = Math.PI / 2; band.position.y = 1.25;
  group.add(body, head, visor, gun, band);
  group.position.set(spawn[0], 0, spawn[1]);
  scene.add(group);

  const loadout = freshLoadout();
  loadout.owned = { p9: true, hornet: true, vk47: true, breacher: true };
  loadout.current = weaponId;
  loadout.mag = { p9: 12, hornet: 28, vk47: 25, breacher: 6 };
  loadout.reserve = { p9: 999, hornet: 999, vk47: 999, breacher: 999 };
  return {
    id, name, team, mesh: group, gun,
    pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
    yaw: team === 'crew' ? 0 : Math.PI,   // crew faces north (-z), guards face south
    pitch: 0,
    hp: 100, alive: true,
    eyeH: 1.55, speed: 0, crouched: false, airborne: false,
    loadout,
    // AI
    mode: 'patrol',       // patrol | hold | investigate | engage | defuse | plant-escort
    path: [], pathI: 0,
    holdSpot: null, holdUntil: 0,
    target: null,         // fighter currently engaged
    lastSeen: null,       // Vector3 where the target was last seen
    lastSeenAt: -99,
    burstLeft: 0, burstPause: 0,
    strafeDir: 1, strafeUntil: 0,
    repathAt: 0,
    thinkAt: Math.random() * 0.3,
  };
}

export function spawnBots(scene, spawns) {
  const bots = [];
  spawns.crew.slice(1).forEach((s, i) => {
    bots.push(makeBot(scene, `crew-${i}`, BOT_NAMES.crew[i % 3], 'crew', s, ['hornet', 'vk47', 'p9'][i % 3]));
  });
  spawns.guard.forEach((s, i) => {
    bots.push(makeBot(scene, `guard-${i}`, BOT_NAMES.guard[i % 5], 'guard', s, ['vk47', 'hornet', 'breacher', 'p9', 'vk47'][i % 5]));
  });
  return bots;
}

const _tmp = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

// One fixed-step AI tick. Bots think on a staggered schedule so they do not all
// repath on the same frame.
export function updateBot(state, bot, colliders, map, dt, audio, onKill) {
  if (!bot.alive) return;
  bot.thinkAt -= dt;
  const player = state.player;

  // --- perception: nearest visible enemy ---
  let enemy = null, enemyDist = Infinity;
  const fighters = state.bots.concat(player);
  for (const f of fighters) {
    if (f === bot || !f.alive || f.team === bot.team) continue;
    const d = bot.pos.distanceTo(f.pos);
    if (d < enemyDist && canSee(colliders, bot, f, 34)) { enemy = f; enemyDist = d; }
  }
  if (enemy) {
    bot.target = enemy;
    bot.lastSeen = enemy.pos.clone();
    bot.lastSeenAt = state.time;
    if (bot.mode !== 'engage') bot.mode = 'engage';
  } else if (bot.target && state.time - bot.lastSeenAt > 2.5) {
    bot.target = null;
    if (bot.mode === 'engage') { bot.mode = 'investigate'; }
  }

  // --- hearing: a recent gunshot nearby pulls a patrolling bot over ---
  if (bot.mode === 'patrol' || bot.mode === 'hold') {
    for (const n of state.noise) {
      if (bot.pos.distanceTo(n.pos) < n.radius) {
        bot.mode = 'investigate';
        bot.lastSeen = n.pos.clone();
        bot.lastSeenAt = state.time;
        bot.path = findPath(map.waypoints, map.adj, bot.pos, n.pos);
        bot.pathI = 0;
        break;
      }
    }
  }

  // --- the charge changes everyone's job ---
  if (state.charge.state === 'planted' && bot.team === 'guard' && bot.mode !== 'engage') {
    bot.mode = 'defuse';
    bot.path = findPath(map.waypoints, map.adj, bot.pos, map.plantSpot);
    bot.pathI = 0;
  }
  if (state.charge.state === 'planted' && bot.team === 'crew' && bot.mode === 'patrol') {
    bot.mode = 'hold';
    bot.holdSpot = bot.pos.clone();
    bot.holdUntil = state.time + 6;
  }

  // --- movement by mode ---
  let moveTarget = null, moveSpeed = 2.6;
  if (bot.mode === 'engage' && bot.target) {
    // strafe perpendicular to the target, keep a fighting distance
    if (state.time > bot.strafeUntil) {
      bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      bot.strafeUntil = state.time + 0.7 + Math.random() * 0.9;
    }
    _toTarget.copy(bot.target.pos).sub(bot.pos); _toTarget.y = 0;
    const dist = _toTarget.length();
    const fwd = _toTarget.clone().normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(bot.strafeDir);
    const want = dist > 14 ? fwd : dist < 6 ? fwd.clone().multiplyScalar(-1) : side;
    moveTarget = bot.pos.clone().add(want);
    moveSpeed = 3.4;
  } else if (bot.mode === 'investigate' || bot.mode === 'defuse') {
    moveTarget = bot.path[bot.pathI] || bot.lastSeen;
    if (moveTarget && bot.pos.distanceTo(moveTarget) < 0.8) {
      bot.pathI++;
      if (bot.pathI >= bot.path.length) {
        bot.mode = bot.mode === 'defuse' ? 'defuse' : 'hold';
        bot.holdSpot = bot.pos.clone();
        bot.holdUntil = state.time + 4;
      }
    }
    moveSpeed = 3.6;
  } else if (bot.mode === 'hold') {
    if (state.time > bot.holdUntil) { bot.mode = 'patrol'; bot.repathAt = 0; }
  } else { // patrol
    if (bot.pathI >= bot.path.length || state.time > bot.repathAt) {
      const dest = map.waypoints[Math.floor(Math.random() * map.waypoints.length)];
      bot.path = findPath(map.waypoints, map.adj, bot.pos, dest);
      bot.pathI = 0;
      bot.repathAt = state.time + 14;
    }
    moveTarget = bot.path[bot.pathI];
    if (moveTarget && bot.pos.distanceTo(moveTarget) < 0.8) bot.pathI++;
    moveSpeed = 2.4;
  }

  if (moveTarget) {
    _tmp.copy(moveTarget).sub(bot.pos); _tmp.y = 0;
    const d = _tmp.length();
    if (d > 0.05) {
      _tmp.normalize();
      const wantYaw = Math.atan2(-_tmp.x, -_tmp.z);
      bot.yaw = turnToward(bot.yaw, wantYaw, dt * 6);
      bot.pos.addScaledVector(_tmp, moveSpeed * dt);
      collideCircle(colliders, bot.pos, 0.42);
      bot.speed = moveSpeed;
    } else bot.speed = 0;
  } else bot.speed = 0;

  // face the target while engaging; face movement otherwise
  if (bot.mode === 'engage' && bot.target) {
    _toTarget.copy(bot.target.pos).sub(bot.pos);
    bot.yaw = Math.atan2(-_toTarget.x, -_toTarget.z);
    bot.pitch = Math.atan2(bot.target.pos.y + 1.2 - (bot.pos.y + 1.55), Math.hypot(_toTarget.x, _toTarget.z));
  }

  // --- firing: bursts with pauses, accuracy worse at range ---
  bot.burstPause -= dt;
  if (bot.mode === 'engage' && bot.target && bot.target.alive && bot.burstPause <= 0) {
    if (bot.burstLeft <= 0) {
      // start a burst; longer bursts up close, single taps far away
      bot.burstLeft = enemyDist < 12 ? 3 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
      bot.burstPause = 0.5 + Math.random() * 0.7;
    }
    if (bot.burstLeft > 0 && state.time - bot.loadout.lastShot > WEAPONS[bot.loadout.current].interval) {
      // bots aim with error that grows with distance
      const err = 0.02 + enemyDist * 0.0016;
      const savedYaw = bot.yaw, savedPitch = bot.pitch;
      bot.yaw += (Math.random() - 0.5) * err * 2;
      bot.pitch += (Math.random() - 0.5) * err * 2;
      shoot(state, bot, bot.loadout, colliders, audio, onKill);
      bot.yaw = savedYaw; bot.pitch = savedPitch;
      bot.burstLeft--;
      bot.loadout.lastShot = state.time;
    }
  }

  // reload when the mag runs dry
  if (bot.loadout.mag[bot.loadout.current] <= 0) {
    bot.loadout.mag[bot.loadout.current] = WEAPONS[bot.loadout.current].mag;
  }

  // --- defuse: a guard standing at the planted charge disarms it ---
  if (bot.mode === 'defuse' && state.charge.state === 'planted') {
    if (bot.pos.distanceTo(map.plantSpot) < 1.6) {
      state.charge.state = 'defusing';
      state.charge.progress += dt / 4.0;
      if (Math.random() < dt * 2) audio.defuseBeep();
      if (state.charge.progress >= 1) {
        state.charge.state = 'defused';
      }
    }
  }

  // sync the visible mesh
  bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  bot.mesh.rotation.y = bot.yaw;
  bot.gun.visible = bot.alive;
}

function turnToward(yaw, target, maxStep) {
  let d = target - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return yaw + Math.sign(d) * maxStep;
}

// A dead bot's mesh is hidden by combat; this resets all bots for a new round.
export function resetBots(bots, spawns, scene) {
  const all = spawns.crew.slice(1).map((s, i) => ({ bot: bots[i], spawn: s }));
  spawns.guard.forEach((s, i) => all.push({ bot: bots[3 + i], spawn: s }));
  for (const { bot, spawn } of all) {
    if (!bot) continue;
    bot.pos.set(spawn[0], 0, spawn[1]);
    bot.hp = 100; bot.alive = true;
    bot.mesh.visible = true;
    bot.mesh.position.set(spawn[0], 0, spawn[1]);
    bot.yaw = bot.team === 'crew' ? 0 : Math.PI;
    bot.mode = 'patrol'; bot.path = []; bot.pathI = 0;
    bot.target = null; bot.burstLeft = 0;
    bot.loadout.mag[bot.loadout.current] = WEAPONS[bot.loadout.current].mag;
  }
}

export { hasLOS };
