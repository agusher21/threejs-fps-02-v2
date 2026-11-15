// hud.js — everything the player reads while playing: health and stamina bars,
// ammunition, the round timer and score, money, the killfeed, the buy menu, the
// objective banner — and the radar, a top-down canvas that draws the bank's walls
// and every living fighter as a dot: the player as an arrow, teammates green,
// enemies red.
import { WEAPONS, GRENADE, BUY_MENU } from './weapons.js';
import { ROUND } from './state.js';

export function createHUD() {
  const $ = (id) => document.getElementById(id);
  return {
    healthFill: $('health-fill'), healthNum: $('health-num'),
    staminaFill: $('stamina-fill'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    timer: $('timer'), score: $('score'), money: $('money'),
    teamCrew: $('team-crew'), teamGuard: $('team-guard'),
    killfeed: $('killfeed'), banner: $('banner'), objective: $('objective'),
    buyMenu: $('buy-menu'), buyList: $('buy-list'), buyMoney: $('buy-money'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    vignette: $('vignette'), radar: $('radar'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'), playBtn: $('play'),
    radarCtx: $('radar').getContext('2d'),
    _hitAt: 0,
  };
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function updateHUD(hud, state, player, loadout) {
  const w = WEAPONS[loadout.current];
  hud.healthFill.style.width = `${Math.max(0, player.hp)}%`;
  hud.healthNum.textContent = Math.ceil(Math.max(0, player.hp));
  hud.healthFill.style.background = player.hp > 50 ? '#2fd4a7' : player.hp > 25 ? '#f0a830' : '#e14b4b';
  hud.staminaFill.style.width = `${player.stamina}%`;
  hud.staminaFill.style.background = player.stamina < 25 ? '#e14b4b' : '#7ec8e3';
  hud.ammoMag.textContent = loadout.mag[w.id];
  hud.ammoReserve.textContent = `/ ${loadout.reserve[w.id]}`;
  hud.ammoBox.classList.toggle('empty', loadout.mag[w.id] === 0);
  hud.ammoBox.classList.toggle('reloading', loadout.reloading > 0);
  hud.weaponName.textContent = loadout.reloading > 0 ? 'RELOADING…' : w.name + (loadout.grenades ? '  ·  ◉ frag' : '');
  hud.timer.textContent = state.phase === 'planted' ? `💥 ${fmtTime(state.charge.fuse)}` : fmtTime(state.timer);
  hud.timer.style.color = state.timer < 20 || state.phase === 'planted' ? '#e14b4b' : '';
  hud.score.innerHTML = `CREW <b>${state.score.crew}</b> — <b>${state.score.guard}</b> GUARD · R${state.round}`;
  hud.money.textContent = `$${state.money}`;
  const crewAlive = state.bots.filter((b) => b.team === 'crew' && b.alive).length + (player.alive ? 1 : 0);
  const guardAlive = state.bots.filter((b) => b.team === 'guard' && b.alive).length;
  hud.teamCrew.textContent = '●'.repeat(crewAlive) + '○'.repeat(4 - crewAlive);
  hud.teamGuard.textContent = '●'.repeat(guardAlive) + '○'.repeat(5 - guardAlive);

  // killfeed: newest first, fading out
  hud.killfeed.innerHTML = state.killfeed.slice(0, 4)
    .map((k) => `<div style="color:${k.color}">${k.text}</div>`).join('');

  // objective line under the timer
  const c = state.charge;
  hud.objective.textContent =
    c.state === 'planted' ? 'CHARGE PLANTED — defend it until it blows!' :
    c.state === 'planting' ? 'PLANTING THE CHARGE…' :
    c.state === 'defusing' ? 'A GUARD IS DEFUSING THE CHARGE!' :
    state.phase === 'buy' ? 'Buy phase — B for the buy menu, then push the vault' :
    'Objective: plant the breaching charge on the vault door (hold E)';

  // buy menu
  if (state.phase === 'buy') {
    hud.buyMenu.hidden = false;
    hud.buyMoney.textContent = `$${state.money}`;
    hud.buyList.innerHTML = BUY_MENU.map((item) => {
      const isGrenade = item.id === 'frag';
      const owned = isGrenade ? loadout.grenades > 0 : loadout.owned[item.id];
      const price = isGrenade ? GRENADE.price : WEAPONS[item.id].price;
      const afford = state.money >= price;
      return `<div class="buy-row${owned ? ' owned' : ''}${!afford && !owned ? ' poor' : ''}">
        <kbd>${item.key}</kbd><b>${isGrenade ? GRENADE.name : WEAPONS[item.id].name}</b>
        <span>${item.note}</span><em>${owned ? 'OWNED' : '$' + price}</em></div>`;
    }).join('');
  } else {
    hud.buyMenu.hidden = true;
  }

  // damage vignette: red flash while recently hurt
  hud.vignette.style.opacity = player.hp < 100 ? String(Math.min(0.55, (100 - player.hp) / 130 + 0.12)) : '0';
  // hitmarker flashes for 120 ms after a hit the player scored
  hud.hitmarker.classList.toggle('on', performance.now() - hud._hitAt < 120);
  // crosshair spreads with bloom: the gap is the spread you are shooting with
  const gap = 3 + loadout.spreadBloom * 160;
  hud.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
}

export function flashHitmarker(hud) { hud._hitAt = performance.now(); }

// --- radar ---
// The bank is 64 x 44 metres; the canvas is 148 px, so 1 m ≈ 2.1 px.
export function drawRadar(hud, state, player, map) {
  const ctx = hud.radarCtx;
  const S = 148, k = S / 68, ox = S / 2, oz = S / 2;
  const X = (x) => ox + x * k, Z = (z) => oz + z * k;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,14,12,0.72)';
  ctx.fillRect(0, 0, S, S);
  // walls
  ctx.strokeStyle = 'rgba(233,230,223,0.5)';
  ctx.lineWidth = 1;
  for (const c of map.colliders) {
    if (c.h < 2) continue;
    ctx.strokeRect(X(c.minX), Z(c.minZ), (c.maxX - c.minX) * k, (c.maxZ - c.minZ) * k);
  }
  // vault door: gold square
  ctx.fillStyle = '#d9b64a';
  ctx.fillRect(X(-2.2), Z(-12.6), 4.4 * k, 1.2 * k);
  // planted charge: blinking yellow
  if (state.charge.state === 'planted' && Math.floor(performance.now() / 300) % 2 === 0) {
    ctx.fillStyle = '#ffe14b';
    ctx.beginPath(); ctx.arc(X(0), Z(-10.4), 5, 0, Math.PI * 2); ctx.fill();
  }
  // fighters: teammates green, enemies RED, player a white arrow
  for (const b of state.bots) {
    if (!b.alive) continue;
    ctx.fillStyle = b.team === 'crew' ? '#2fd4a7' : '#ff3b30';
    ctx.beginPath(); ctx.arc(X(b.pos.x), Z(b.pos.z), b.team === 'guard' ? 3.4 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(X(player.pos.x), Z(player.pos.z));
  ctx.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(-4.4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  // north tick
  ctx.fillStyle = 'rgba(233,230,223,0.7)';
  ctx.font = '9px sans-serif'; ctx.fillText('N', S / 2 - 3, 10);
}

export function showOverlay(hud, title, copy, button) {
  hud.overlayTitle.textContent = title;
  hud.overlayCopy.textContent = copy;
  hud.playBtn.textContent = button;
  hud.overlay.hidden = false;
}

export function showBanner(hud, text, color) {
  hud.banner.textContent = text;
  hud.banner.style.color = color || '#e9e6df';
  hud.banner.style.opacity = '1';
  setTimeout(() => { hud.banner.style.opacity = '0'; }, 2600);
}

export function setRoundScore(hud, state) {
  hud.score.innerHTML = `CREW <b>${state.score.crew}</b> — <b>${state.score.guard}</b> GUARD · R${state.round}`;
}
