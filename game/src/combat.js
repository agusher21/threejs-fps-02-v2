// combat.js — shooting, damage, tracers and grenades. One raycast per pellet
// from the shooter's eye; a hit against a body hurts, a hit against a head
// hurts double. Everything here is pure sim: it never touches the DOM.
// Reused scratch objects live at module scope — no allocation in the hot loop.
import * as THREE from 'three';
import { WEAPONS, GRENADE, damageAt, currentSpread } from './weapons.js';
import { hasLOS } from './bank.js';

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _ray = new THREE.Raycaster();
_ray.far = 120;

function eyeOf(f) {
  _eye.set(f.pos.x, f.pos.y + (f.eyeH ?? 1.55), f.pos.z);
  return _eye;
}

// A fighter is a sphere body (r 0.45, centre y+0.95) plus a head sphere
// (r 0.26, centre y+1.55). Returns {target, part, dist} or null.
function rayHitFighters(origin, dir, fighters, ignore) {
  let best = null;
  for (const f of fighters) {
    if (f === ignore || !f.alive || f.team === ignore.team) continue; // no friendly fire
    // body sphere
    _to.set(f.pos.x, f.pos.y + 0.95, f.pos.z);
    const d = _ray.ray.distanceSqToPoint(_to);
    if (d < 0.45 * 0.45) {
      const dist = origin.distanceTo(_to) - Math.sqrt(Math.max(0, 0.45 * 0.45 - d));
      if (!best || dist < best.dist) best = { target: f, part: 'body', dist };
    }
    // head sphere (smaller, worth double)
    _to.set(f.pos.x, f.pos.y + 1.55, f.pos.z);
    const dh = _ray.ray.distanceSqToPoint(_to);
    if (dh < 0.26 * 0.26) {
      const dist = origin.distanceTo(_to) - Math.sqrt(Math.max(0, 0.26 * 0.26 - dh));
      if (!best || dist < best.dist) best = { target: f, part: 'head', dist };
    }
  }
  return best;
}

// Nearest wall along the ray, so a bullet stops at the first wall it meets.
function rayHitWalls(origin, dir, colliders) {
  let best = Infinity;
  for (const c of colliders) {
    if (c.h < 1.2) continue; // counters and desks are low: bullets fly over them
    const t = rayAABB(origin, dir, c);
    if (t !== null && t < best) best = t;
  }
  return best;
}

function rayAABB(o, d, c) {
  let tmin = 0, tmax = 120;
  // x slab
  if (Math.abs(d.x) < 1e-9) { if (o.x < c.minX || o.x > c.maxX) return null; }
  else {
    let t1 = (c.minX - o.x) / d.x, t2 = (c.maxX - o.x) / d.x;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.z) < 1e-9) { if (o.z < c.minZ || o.z > c.maxZ) return null; }
  else {
    let t1 = (c.minZ - o.z) / d.z, t2 = (c.maxZ - o.z) / d.z;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // the wall must actually be tall enough to reach the ray's height
  const yAt = o.y + d.y * tmin;
  if (yAt > c.h) return null;
  return tmin;
}

export function shoot(state, shooter, loadout, colliders, audio, onKill) {
  const w = WEAPONS[loadout.current];
  const now = state.time;
  if (now - loadout.lastShot < w.interval) return false;
  if (loadout.reloading > 0) return false;
  if (loadout.mag[w.id] <= 0) { audio.dryFire(); loadout.lastShot = now; return false; }
  loadout.lastShot = now;
  loadout.mag[w.id] -= 1;
  loadout.spreadBloom = Math.min(w.spreadMax, loadout.spreadBloom + w.spreadPerShot);

  const origin = eyeOf(shooter).clone();
  const fighters = state.bots.concat(state.player);
  let hitSomething = false;
  for (let p = 0; p < w.pellets; p++) {
    const spread = currentSpread(w, loadout, shooter.speed || 0, shooter.airborne || false, shooter.crouched || false);
    // base direction: forward is -z rotated by yaw, pitched by pitch
    const cp = Math.cos(shooter.pitch);
    _dir.set(
      -Math.sin(shooter.yaw) * cp + (Math.random() - 0.5) * 2 * spread,
      Math.sin(shooter.pitch) + (Math.random() - 0.5) * 2 * spread,
      -Math.cos(shooter.yaw) * cp + (Math.random() - 0.5) * 2 * spread,
    ).normalize();
    _ray.set(origin, _dir);
    _ray.far = 120;
    const wallDist = rayHitWalls(origin, _dir, colliders);
    const hit = rayHitFighters(origin, _dir, fighters, shooter);
    const end = new THREE.Vector3();
    if (hit && hit.dist < wallDist) {
      const mult = hit.part === 'head' ? w.headMult : 1;
      const dmg = damageAt(w, hit.dist) * mult;
      hitSomething = true;
      end.copy(origin).addScaledVector(_dir, hit.dist);
      applyDamage(state, hit.target, dmg, shooter, hit.part === 'head', audio, onKill);
    } else {
      const d = wallDist === Infinity ? 60 : wallDist;
      end.copy(origin).addScaledVector(_dir, d);
    }
    addTracer(state, origin, end);
  }
  // recoil kicks the pitch up; main.js recovers it from loadout.recoilPitch
  loadout.recoilPitch = Math.min(0.2, (loadout.recoilPitch || 0) + w.recoil);
  shooter.pitch = Math.min(1.2, shooter.pitch + w.recoil * 0.6);
  // the shot is noise bots can hear
  state.noise.push({ pos: shooter.pos.clone(), radius: 26, life: 0.6 });
  if (shooter === state.player) audio.shot(0);
  else audio.shot(shooter.pos.distanceTo(state.player.pos));
  return hitSomething;
}

export function applyDamage(state, target, dmg, attacker, headshot, audio, onKill) {
  if (!target.alive) return;
  target.hp -= dmg;
  if (target === state.player) {
    audio.hurt();
    state.shake = Math.min(1, state.shake + 0.35);
  } else if (attacker === state.player) {
    audio.hit();
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    if (target.mesh) target.mesh.visible = false;
    const killer = attacker === state.player ? 'You' : attacker.name;
    const victim = target === state.player ? 'You' : target.name;
    state.killfeed.unshift({ text: `${killer} ▸ ${victim}${headshot ? '  ◉ headshot' : ''}`, color: attacker.team === 'crew' ? '#2fd4a7' : '#e14b4b', life: 5 });
    if (attacker === state.player) {
      state.money += 300;
      state.kills += 1;
      audio.kill();
    }
    if (target === state.player) state.deaths += 1;
    if (onKill) onKill(target, attacker);
  }
}

const MAX_TRACERS = 24;
export function addTracer(state, a, b) {
  if (state.tracers.length >= MAX_TRACERS) state.tracers.shift();
  state.tracers.push({ a: a.clone(), b: b.clone(), life: 0.09 });
}

export function throwGrenade(state, thrower, loadout, audio) {
  if (loadout.grenades <= 0) return false;
  loadout.grenades -= 1;
  _dir.set(-Math.sin(thrower.yaw), Math.sin(thrower.pitch) + 0.4, -Math.cos(thrower.yaw)).normalize();
  state.grenades.push({
    pos: eyeOf(thrower).clone(),
    vel: _dir.clone().multiplyScalar(GRENADE.throwSpeed),
    fuse: GRENADE.fuse,
    owner: thrower,
  });
  audio.grenadePin();
  return true;
}

export function updateGrenades(state, colliders, dt, audio, onKill) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 12 * dt;
    g.pos.addScaledVector(g.vel, dt);
    // bounce off the floor and walls, cheaply
    if (g.pos.y < 0.15) { g.pos.y = 0.15; g.vel.y *= -0.45; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    if (g.pos.x < -31.5 || g.pos.x > 31.5) g.vel.x *= -0.5;
    if (g.pos.z < -21.5 || g.pos.z > 21.5) g.vel.z *= -0.5;
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      audio.explosion();
      state.shake = Math.min(1, state.shake + 0.5);
      const fighters = state.bots.concat(state.player);
      for (const f of fighters) {
        if (!f.alive || f === g.owner || f.team === g.owner.team) continue;
        const d = f.pos.distanceTo(g.pos);
        if (d < GRENADE.radius) {
          const dmg = GRENADE.maxDamage * (1 - d / GRENADE.radius);
          applyDamage(state, f, dmg, g.owner, false, audio, onKill);
        }
      }
    }
  }
}

// Can this fighter see that one? Range, field of view, and a clear line.
export function canSee(colliders, a, b, maxDist = 34, fovCos = -0.15) {
  _to.copy(b.pos).sub(a.pos);
  const d = _to.length();
  if (d > maxDist || d < 0.5) return d < 0.5;
  _to.y = 0;
  _dir.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
  if (_to.normalize().dot(_dir) < fovCos) return false;
  return hasLOS(colliders, eyeOf(a), eyeOf(b));
}
