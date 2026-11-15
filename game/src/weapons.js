// weapons.js — every gun, the buy catalogue, and the ballistics that make
// stopping to aim pay: spread grows while moving and while firing, recoil kicks
// the camera, damage falls off with range, and a head hit pays double.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'Kestrel P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 2.0, mag: 12, reserve: 48,
    interval: 0.32, auto: false, reload: 1.1,
    spread: 0.011, moveSpread: 2.4, spreadPerShot: 0.004, spreadMax: 0.05,
    recoil: 0.011, falloffFrom: 18, falloffTo: 45, falloffMin: 0.55,
    pellets: 1, tracer: 0xffe08a,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9 SMG', kind: 'smg', price: 1400,
    damage: 19, headMult: 2.0, mag: 28, reserve: 112,
    interval: 0.09, auto: true, reload: 1.6,
    spread: 0.016, moveSpread: 2.2, spreadPerShot: 0.0035, spreadMax: 0.06,
    recoil: 0.007, falloffFrom: 14, falloffTo: 38, falloffMin: 0.5,
    pellets: 1, tracer: 0xffd27a,
  },
  vk47: {
    id: 'vk47', name: 'Longarm VK-47', kind: 'rifle', price: 2700,
    damage: 34, headMult: 2.0, mag: 25, reserve: 75,
    interval: 0.13, auto: true, reload: 2.0,
    spread: 0.009, moveSpread: 2.6, spreadPerShot: 0.004, spreadMax: 0.055,
    recoil: 0.013, falloffFrom: 22, falloffTo: 55, falloffMin: 0.6,
    pellets: 1, tracer: 0xffe08a,
  },
  breacher: {
    id: 'breacher', name: 'Door-Breacher 12', kind: 'shotgun', price: 1100,
    damage: 9, headMult: 1.8, mag: 6, reserve: 24,
    interval: 0.8, auto: false, reload: 2.4,
    spread: 0.045, moveSpread: 1.6, spreadPerShot: 0.012, spreadMax: 0.09,
    recoil: 0.035, falloffFrom: 8, falloffTo: 22, falloffMin: 0.3,
    pellets: 8, tracer: 0xffc46a,
  },
};

export const GRENADE = {
  id: 'frag', name: 'Frag Grenade', price: 300,
  fuse: 1.6, radius: 6.5, maxDamage: 120, throwSpeed: 17,
};

export const BUY_MENU = [
  { key: '1', id: 'p9', note: 'Sidearm — free, always carried' },
  { key: '2', id: 'hornet', note: 'Fast close-quarters spray' },
  { key: '3', id: 'vk47', note: 'Accurate at long lanes' },
  { key: '4', id: 'breacher', note: 'Devastating up close' },
  { key: '5', id: 'frag', note: 'Frag grenade — clears a room' },
];

// A fresh loadout: pistol owned, pistol equipped, one grenade slot empty.
export function freshLoadout() {
  return {
    owned: { p9: true },
    current: 'p9',
    mag: { p9: WEAPONS.p9.mag, hornet: 0, vk47: 0, breacher: 0 },
    reserve: { p9: WEAPONS.p9.reserve, hornet: 0, vk47: 0, breacher: 0 },
    grenades: 0,
    spreadBloom: 0,   // extra spread from recent fire, decays
    recoilPitch: 0,   // accumulated pitch kick, recovered over time
    lastShot: -99,
    reloading: 0,     // seconds left, 0 when not reloading
  };
}

export function buyWeapon(loadout, money, id) {
  const w = WEAPONS[id];
  if (!w || loadout.owned[id]) return { ok: false, money };
  if (money < w.price) return { ok: false, money };
  loadout.owned[id] = true;
  loadout.mag[id] = w.mag;
  loadout.reserve[id] = w.reserve;
  loadout.current = id;
  return { ok: true, money: money - w.price };
}

export function buyGrenade(loadout, money) {
  if (loadout.grenades >= 1 || money < GRENADE.price) return { ok: false, money };
  loadout.grenades = 1;
  return { ok: true, money: money - GRENADE.price };
}

// Damage after range falloff. A head hit multiplies afterwards.
export function damageAt(w, dist) {
  if (dist <= w.falloffFrom) return w.damage;
  if (dist >= w.falloffTo) return w.damage * w.falloffMin;
  const t = (dist - w.falloffFrom) / (w.falloffTo - w.falloffFrom);
  return w.damage * (1 - t * (1 - w.falloffMin));
}

// Current spread in radians for a shooter: base, worse while moving or in the
// air, worse while crouched less, plus bloom from recent shots.
export function currentSpread(w, loadout, speed, airborne, crouched) {
  let s = w.spread + loadout.spreadBloom;
  if (speed > 0.5) s *= 1 + (w.moveSpread - 1) * Math.min(1, speed / 6);
  if (airborne) s *= 1.8;
  if (crouched) s *= 0.75;
  return Math.min(s, w.spreadMax);
}
