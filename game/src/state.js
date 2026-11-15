// state.js — the one place the whole game keeps its mutable state.
// Every module reads and writes this object; nothing else holds game state.
// A fresh state is made per page load and reset per round by resetRound().
import * as THREE from 'three';

export const MAP = { halfX: 32, halfZ: 22, wallH: 5 };

// Team ids: 'crew' attacks the vault, 'guard' defends it.
export const TEAMS = {
  crew: { name: 'Crew', color: 0x2fd4a7, css: '#2fd4a7' },
  guard: { name: 'Vault Guard', color: 0xe14b4b, css: '#e14b4b' },
};

export const ROUND = {
  time: 100,        // seconds of live play per round
  buyTime: 15,      // seconds at round start when the buy menu is open
  plantTime: 3.5,   // seconds holding E at the vault door to plant
  defuseTime: 4.0,  // seconds holding E at the charge to defuse
  fuseTime: 30,     // seconds from plant to detonation
  winScore: 5,      // first team to this many round wins takes the match
  startMoney: 800,
  killBonus: 300,
  winBonus: 1000,
  lossBonus: 800,
  plantBonus: 300,
  defuseBonus: 300,
};

export function createState() {
  return {
    phase: 'menu',           // menu | buy | live | planted | over
    round: 1,
    score: { crew: 0, guard: 0 },
    timer: ROUND.time,
    buyLeft: ROUND.buyTime,
    money: ROUND.startMoney,
    kills: 0,
    deaths: 0,
    matchWinner: null,
    roundWinner: null,
    roundReason: '',
    // the breaching charge on the vault door
    charge: {
      state: 'none',         // none | planting | planted | defusing | detonated | defused
      progress: 0,           // 0..1 for the current plant/defuse hold
      fuse: 0,               // countdown once planted
      pos: new THREE.Vector3(0, 1.1, -11.15),
    },
    // the player is a bot-shaped object so combat code treats everyone alike
    player: null,
    bots: [],                // every bot, crew and guard, player excluded
    tracers: [],             // {a: Vector3, b: Vector3, life} — pooled, reused
    grenades: [],            // live frag grenades
    killfeed: [],            // {text, color, life}
    noise: [],               // {pos, radius, life} — gunshots bots can hear
    shake: 0,                // camera shake amount
    time: 0,                 // total sim seconds this page load
    roundTime: 0,            // sim seconds inside the current round
    muted: false,
    shotMode: null,          // 'lobby' | 'vault' | 'combat' when ?shot= is set
  };
}

// Reset the per-round fields without touching the match score or money.
export function resetRound(state) {
  state.phase = 'buy';
  state.timer = ROUND.time;
  state.buyLeft = ROUND.buyTime;
  state.roundTime = 0;
  state.roundWinner = null;
  state.roundReason = '';
  state.charge.state = 'none';
  state.charge.progress = 0;
  state.charge.fuse = 0;
  state.tracers.length = 0;
  state.grenades.length = 0;
  state.noise.length = 0;
  state.killfeed.length = 0;
}
