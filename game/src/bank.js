// bank.js — the bank interior: geometry, collision, waypoints, spawns.
// The map is one floor, entirely indoors: a lobby in the south, a teller hall in the
// middle, a vault in the north, and two side corridors with offices. Two lanes run
// from the lobby to the vault antechamber (west corridor, east corridor), plus the
// open middle hall, so attackers pick a lane and defenders hold angles on each one.
// Collision is a flat list of AABBs; sight lines only respect tall ones, so a rifle
// can shoot over a teller counter but not through a wall.
import * as THREE from 'three';
import { MAP } from './state.js';

// Palette: cream marble, dark bank green, brass, walnut. One chosen palette, used
// everywhere, so the scene reads at a glance.
export const PALETTE = {
  floor: 0xd8cfbc,
  floorDark: 0xb8ad93,
  wall: 0xe9e2d0,
  green: 0x1e4d3b,
  brass: 0xc9a227,
  gold: 0xd9b64a,
  wood: 0x5a3a22,
  woodDark: 0x3a2517,
  steel: 0x8a8f96,
  steelDark: 0x565b63,
  glass: 0x9fc4c8,
  counter: 0x2e4a3e,
  carpet: 0x7a2e2e,
};

function marbleTexture() {
  // Procedural marble-tile floor: a canvas texture, no network, no asset file.
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d8cfbc'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#cfc4a8' : '#ddd5c0';
      g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
      g.strokeStyle = 'rgba(120,100,60,0.25)';
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        const sx = x * 128 + 8 + Math.random() * 112;
        g.moveTo(sx, y * 128 + 4);
        g.bezierCurveTo(sx + 20, y * 128 + 50, sx - 16, y * 128 + 80, sx + 8, y * 128 + 124);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildBank(scene) {
  const mats = {
    floor: new THREE.MeshLambertMaterial({ map: marbleTexture() }),
    wall: new THREE.MeshLambertMaterial({ color: PALETTE.wall }),
    green: new THREE.MeshLambertMaterial({ color: PALETTE.green }),
    brass: new THREE.MeshLambertMaterial({ color: PALETTE.brass, emissive: 0x332200 }),
    gold: new THREE.MeshLambertMaterial({ color: PALETTE.gold, emissive: 0x443300 }),
    wood: new THREE.MeshLambertMaterial({ color: PALETTE.wood }),
    woodDark: new THREE.MeshLambertMaterial({ color: PALETTE.woodDark }),
    steel: new THREE.MeshLambertMaterial({ color: PALETTE.steel }),
    steelDark: new THREE.MeshLambertMaterial({ color: PALETTE.steelDark }),
    glass: new THREE.MeshLambertMaterial({ color: PALETTE.glass, transparent: true, opacity: 0.35 }),
    counter: new THREE.MeshLambertMaterial({ color: PALETTE.counter }),
    carpet: new THREE.MeshLambertMaterial({ color: PALETTE.carpet }),
    dark: new THREE.MeshLambertMaterial({ color: 0x5a4f3d }),
  };

  const colliders = [];   // {minX,maxX,minZ,maxZ,h} — h decides whether it blocks sight
  const group = new THREE.Group();
  scene.add(group);

  function box(x0, z0, x1, z1, h, y0, mat, collide = true) {
    const w = x1 - x0, d = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    group.add(m);
    if (collide) colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, h });
    return m;
  }
  function pillar(x, z, r = 0.7) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, MAP.wallH, 10), mats.green);
    m.position.set(x, MAP.wallH / 2, z);
    group.add(m);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.25, 10), mats.brass);
    cap.position.set(x, 1.1, z); group.add(cap);
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, h: MAP.wallH });
  }

  // --- floor, ceiling, outer walls ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2), mats.floor);
  floor.rotation.x = -Math.PI / 2; group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2), mats.dark);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = MAP.wallH; group.add(ceil);
  // lobby carpet runner
  box(-6, 12, 6, 21, 0.02, 0, mats.carpet, false);
  box(-32, -22, 32, -21.9, 0.02, 0, mats.carpet, false);
  const H = MAP.wallH, X = MAP.halfX, Z = MAP.halfZ;
  box(-X - 0.5, -Z, -X, Z, H, 0, mats.wall);            // west outer
  box(X, -Z, X + 0.5, Z, H, 0, mats.wall);              // east outer
  box(-X, -Z - 0.5, X, -Z, H, 0, mats.wall);            // north outer
  box(-X, Z, -12, Z + 0.5, H, 0, mats.wall);            // south outer, west of entrance
  box(12, Z, X, Z + 0.5, H, 0, mats.wall);              // south outer, east of entrance
  // entrance: glass doors in the middle of the south wall (closed — nobody leaves)
  box(-12, Z, -2, Z + 0.5, H, 0, mats.glass);
  box(2, Z, 12, Z + 0.5, H, 0, mats.glass);
  box(-2, Z, 2, Z + 0.5, 1.2, 0, mats.brass);           // door frame bar

  // --- teller counter row (z = 8), three segments, two gaps to push through ---
  box(-32, 7.4, -20, 8.6, 1.15, 0, mats.counter);
  box(-16, 7.4, -2, 8.6, 1.15, 0, mats.counter);
  box(2, 7.4, 16, 8.6, 1.15, 0, mats.counter);
  box(20, 7.4, 32, 8.6, 1.15, 0, mats.counter);
  box(-32, 7.4, -20, 7.7, 0.12, 1.15, mats.brass, false); // brass counter tops
  box(-16, 7.4, -2, 7.7, 0.12, 1.15, mats.brass, false);
  box(2, 7.4, 16, 7.7, 0.12, 1.15, mats.brass, false);
  box(20, 7.4, 32, 7.7, 0.12, 1.15, mats.brass, false);
  // teller stations behind the counters
  for (const sx of [-26, -9, 9, 26]) box(sx - 1.4, 4.6, sx + 1.4, 5.8, 0.8, 0, mats.wood);

  // --- vault wall (z = -12) with the vault door in the middle ---
  box(-32, -12.5, -10, -11.5, H, 0, mats.green);
  box(10, -12.5, 32, -11.5, H, 0, mats.green);
  box(-10, -12.5, -2.2, -11.5, H, 0, mats.green);
  box(2.2, -12.5, 10, -11.5, H, 0, mats.green);
  const vaultDoor = box(-2.2, -12.6, 2.2, -11.4, 3.8, 0, mats.steelDark);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 20), mats.brass);
  wheel.position.set(0, 1.9, -11.35); wheel.rotation.x = 0; group.add(wheel);
  // gold bars stacked inside the vault room (visible through the door gap when it opens)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4 - i; j++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.28), mats.gold);
      bar.position.set(-6 + j * 0.55 + i * 0.25, 0.1 + i * 0.19, -17 - (i % 2) * 0.6);
      group.add(bar);
    }
  }
  box(-9, -20, -5, -14, 1.0, 0, mats.woodDark);          // vault shelves
  box(5, -20, 9, -14, 1.0, 0, mats.woodDark);

  // --- side corridor partitions (x = -20 / +20), door gaps at z = -6 and z = 4 ---
  for (const px of [-20, 20]) {
    box(px - 0.4, -12, px + 0.4, -8, H, 0, mats.wall);
    box(px - 0.4, -4, px + 0.4, 2, H, 0, mats.wall);
    box(px - 0.4, 6, px + 0.4, 8, H, 0, mats.wall);
  }
  // office dividers with a door gap each
  box(-32, -2.4, -27, -1.6, H, 0, mats.wall);           // west offices divider
  box(-23, -2.4, -20, -1.6, H, 0, mats.wall);
  box(20, 0.6, 24, 1.4, H, 0, mats.wall);               // east offices divider
  box(28, 0.6, 32, 1.4, H, 0, mats.wall);
  // office desks + chairs
  for (const [dx, dz] of [[-28, -7], [-28, 4], [28, -7], [28, 5], [-25, -10], [25, -10]]) {
    box(dx - 1.3, dz - 0.7, dx + 1.3, dz + 0.7, 0.8, 0, mats.wood);
    box(dx - 0.3, dz + 1.1, dx + 0.3, dz + 1.6, 0.5, 0, mats.woodDark);
  }
  // ATMs along the lobby walls + benches + plants
  for (const ax of [-30, 30]) for (const az of [12, 16, 20]) box(ax - 0.9, az - 0.6, ax + 0.9, az + 0.6, 1.9, 0, mats.steel);
  box(-8, 12.5, -4, 13.3, 0.5, 0, mats.wood);           // lobby benches
  box(4, 12.5, 8, 13.3, 0.5, 0, mats.wood);
  for (const [px, pz] of [[-14, 19], [14, 19], [-14, -9], [14, -9]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 8), mats.counter);
    pot.position.set(px, 0.35, pz); group.add(pot);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), mats.green);
    bush.position.set(px, 1.1, pz); group.add(bush);
    colliders.push({ minX: px - 0.45, maxX: px + 0.45, minZ: pz - 0.45, maxZ: pz + 0.45, h: 1.4 });
  }
  pillar(-12, 3); pillar(12, 3); pillar(-12, 15); pillar(12, 15);

  // --- lights: warm lobby, cold vault glow, corridor strips ---
  scene.add(new THREE.AmbientLight(0xfff2dd, 0.85));
  const hemi = new THREE.HemisphereLight(0xfff6e0, 0x2a2620, 0.75);
  scene.add(hemi);
  function point(x, y, z, color, intensity, dist) {
    const l = new THREE.PointLight(color, intensity, dist, 1.6);
    l.position.set(x, y, z); scene.add(l);
  }
  point(0, 4.4, 15, 0xffd9a0, 60, 26);
  point(-20, 4.4, 15, 0xffd9a0, 35, 20);
  point(20, 4.4, 15, 0xffd9a0, 35, 20);
  point(0, 4.4, 0, 0xffe9c0, 45, 24);
  point(0, 4.2, -9, 0xffc860, 40, 16);                   // vault antechamber glow
  point(0, 3.5, -17, 0xffb840, 30, 12);                  // gold glow inside the vault
  point(-26, 4.4, -2, 0xdfe8ff, 25, 16);
  point(26, 4.4, -2, 0xdfe8ff, 25, 16);

  // --- waypoints: the routes bots walk. Edges join neighbours in open space. ---
  const wp = [
    [0, 18], [-24, 15], [24, 15], [-18, 8.6], [18, 8.6], [0, 8.6],
    [-24, 3], [24, 3], [0, 3], [-10, 5], [10, 5],
    [-14, -7], [14, -7], [0, -9], [0, -10.6],
    [-26, -2], [26, -2], [-28, 4.5], [28, 4.5], [-28, -7], [28, -7],
    [-26, -10], [26, -10], [0, -17],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edges = [
    [0, 1], [0, 2], [0, 5], [1, 3], [2, 4], [1, 6], [2, 7], [5, 3], [5, 4], [5, 8],
    [3, 6], [4, 7], [6, 8], [7, 8], [6, 9], [7, 10], [8, 9], [8, 10], [9, 11], [10, 12],
    [8, 11], [8, 12], [11, 13], [12, 13], [11, 14], [12, 14], [13, 14],
    [6, 15], [7, 16], [15, 17], [16, 18], [15, 19], [16, 20], [15, 21], [16, 22],
    [11, 21], [12, 22], [21, 23], [19, 21], [20, 22], [13, 23],
  ];
  const adj = wp.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }

  return {
    colliders, waypoints: wp, adj, vaultDoor,
    spawns: {
      crew: [[-5, 18], [-1, 19], [3, 18], [6, 19]],
      guard: [[-6, -9], [6, -9], [-26, 0], [26, 0], [0, 4]],
    },
    vaultPos: new THREE.Vector3(0, 1.4, -11.4),
    plantSpot: new THREE.Vector3(0, 0, -10.4),
  };
}

// Breadth-first path over the waypoint graph; returns world positions to walk.
export function findPath(wp, adj, from, to) {
  let bi = 0, bj = 0, bd = Infinity, bd2 = Infinity;
  for (let i = 0; i < wp.length; i++) {
    const d = (wp[i].x - from.x) ** 2 + (wp[i].z - from.z) ** 2;
    if (d < bd) { bd2 = bd; bj = bi; bd = d; bi = i; }
    const d2 = (wp[i].x - to.x) ** 2 + (wp[i].z - to.z) ** 2;
    if (d2 < bd2) { bj = i; }
  }
  const prev = new Array(wp.length).fill(-1);
  const q = [bi]; prev[bi] = bi;
  while (q.length) {
    const n = q.shift();
    if (n === bj) break;
    for (const m of adj[n]) if (prev[m] < 0) { prev[m] = n; q.push(m); }
  }
  if (prev[bj] < 0) return [to.clone()];
  const path = [];
  let n = bj;
  while (n !== bi) { path.unshift(wp[n].clone()); n = prev[n]; }
  path.push(to.clone());
  return path;
}

// Push a circle (x,z,radius) out of every collider it overlaps. Returns true if it hit.
export function collideCircle(colliders, p, r) {
  let hit = false;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        p.x += dx * push; p.z += dz * push;
      } else {
        // centre inside the box: shove out along the smallest penetration axis
        const pl = p.x - c.minX, pr = c.maxX - p.x, pt = p.z - c.minZ, pb = c.maxZ - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = c.minX - r; else if (m === pr) p.x = c.maxX + r;
        else if (m === pt) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    }
  }
  return hit;
}

// Line of sight between two eye positions: blocked only by tall colliders.
export function hasLOS(colliders, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return true;
  const steps = Math.ceil(len / 0.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t, z = a.z + dz * t;
    for (const c of colliders) {
      if (c.h < 2) continue;
      if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return false;
    }
  }
  return true;
}
