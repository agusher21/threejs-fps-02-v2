// player.js — the human player: acceleration movement, sprint stamina, crouch,
// jump, and the camera. Movement is deliberately CS-like: you accelerate into a
// run, you stop slower than you start, and firing on the move costs accuracy
// (weapons.currentSpread reads the speed this module reports).
import * as THREE from 'three';
import { collideCircle } from './bank.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.42;

export function createPlayer(scene) {
  const body = new THREE.Group();
  // a simple first-person gun: dark receiver, barrel, grip, brass sight
  const gun = new THREE.Group();
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x23262b });
  const brass = new THREE.MeshLambertMaterial({ color: 0xc9a227 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), gunMat);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), gunMat);
  grip.position.set(0, -0.13, 0.12); grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), brass);
  sight.position.set(0, 0.09, -0.1);
  gun.add(receiver, barrel, grip, sight);
  gun.position.set(0.26, -0.24, -0.5);
  gun.scale.setScalar(0.85);
  body.add(gun);
  scene.add(body);

  return {
    pos: new THREE.Vector3(0, 0, 18),
    vel: new THREE.Vector3(),
    yaw: 0,              // facing north (-z) at spawn
    pitch: 0,
    hp: 100,
    alive: true,
    crouched: false,
    airborne: false,
    stamina: 100,
    sprinting: false,
    speed: 0,               // horizontal speed, read by the spread math
    eyeH: EYE_STAND,
    gun,
    body,
    stepAcc: 0,
    team: 'crew',
    name: 'You',
  };
}

const WALK = 4.6, SPRINT = 6.9, CROUCH = 2.4, ACCEL = 42, FRICTION = 10;

export function updatePlayer(p, input, colliders, dt, audio) {
  if (!p.alive) return;
  const wish = new THREE.Vector3();
  if (input.forward) wish.z -= 1;
  if (input.back) wish.z += 1;
  if (input.left) wish.x -= 1;
  if (input.right) wish.x += 1;
  if (wish.lengthSq() > 0) wish.normalize();

  const wantSprint = input.sprint && p.stamina > 1 && wish.lengthSq() > 0 && !p.crouched;
  p.sprinting = wantSprint;
  const top = p.crouched ? CROUCH : wantSprint ? SPRINT : WALK;
  // rotate the wish direction by the player's yaw
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wx = wish.x * cos - wish.z * sin;
  const wz = wish.x * sin + wish.z * cos;
  p.vel.x += wx * ACCEL * dt;
  p.vel.z += wz * ACCEL * dt;
  // friction + clamp to top speed
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (sp > top) { p.vel.x *= top / sp; p.vel.z *= top / sp; }
  if (wish.lengthSq() === 0) {
    const f = Math.max(0, 1 - FRICTION * dt);
    p.vel.x *= f; p.vel.z *= f;
  }
  // integrate one axis at a time so a wall stops one axis, not both
  p.pos.x += p.vel.x * dt;
  collideCircle(colliders, p.pos, RADIUS);
  p.pos.z += p.vel.z * dt;
  collideCircle(colliders, p.pos, RADIUS);
  p.pos.x = Math.max(-31.5, Math.min(31.5, p.pos.x));
  p.pos.z = Math.max(-21.5, Math.min(21.5, p.pos.z));
  p.speed = Math.hypot(p.vel.x, p.vel.z);

  // stamina: sprint drains, everything else regenerates
  if (p.sprinting && p.speed > 1) p.stamina = Math.max(0, p.stamina - 22 * dt);
  else p.stamina = Math.min(100, p.stamina + 14 * dt);

  // crouch lowers the eye and the hitbox; jump is a single small hop
  p.crouched = input.crouch;
  const targetEye = p.crouched ? EYE_CROUCH : EYE_STAND;
  p.eyeH += (targetEye - p.eyeH) * Math.min(1, dt * 12);
  if (input.jump && !p.airborne) { p.vel.y = 4.6; p.airborne = true; }
  if (p.airborne) {
    p.vel.y -= 14 * dt;
    p.pos.y += p.vel.y * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.airborne = false; }
  }

  // footsteps: a soft tick every stride while moving on the ground
  if (p.speed > 1.5 && !p.airborne) {
    p.stepAcc += p.speed * dt;
    if (p.stepAcc > 2.4) { p.stepAcc = 0; audio.step(); }
  }
  input.jump = false;
}
