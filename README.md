# VAULTBREAK — Bank Heist Tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/agusher21/threejs-fps-02-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/agusher21/threejs-fps-02-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the style Counter-Strike made famous, set entirely inside a bank. The Crew pushes through the lobby and the side corridors to plant a breaching charge on the vault door; the Vault Guard holds the angles, the vault, and the defuse.

## The game

- **Two teams, short rounds.** First to 5 round wins takes the match. A round is won by eliminating the other team, by detonating the charge on the vault door, or — for the guards — by running the clock out or defusing the charge.
- **Money between rounds.** Kills pay $300, round wins $1000. Spend it in the buy menu (B during the buy phase): Hornet-9 SMG ($1400), Longarm VK-47 rifle ($2700), Door-Breacher 12 shotgun ($1100), and frag grenades ($300).
- **Gunplay where accuracy counts.** Spread grows while you move or fire, recoil kicks the camera, crouching steadies your aim, and headshots pay double. Movement has acceleration and friction; sprinting drains stamina.
- **Bots that play the map.** Guards patrol the vault and the lanes, hold positions, investigate gunfire, and converge to defuse a planted charge. Crew bots push with you. Everyone shoots back in aimed bursts.
- **HUD:** health and stamina bars, ammunition, round timer and score, team strength, money, killfeed — and a radar that draws the bank's walls with every fighter on it: teammates green, guards red.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (click to lock) |
| Click | Fire |
| Shift | Sprint (drains stamina) |
| Ctrl | Crouch |
| Space | Jump |
| R | Reload |
| G | Throw frag grenade |
| E (hold) | Plant / defuse the charge |
| B | Buy menu (buy phase) |
| 1–5 | Buy weapon / grenade |
| M | Mute |

## Play it

Serve `game/` with any static file server and open `index.html` in desktop Chrome:

```sh
cd game && python3 -m http.server 8000
```

No build step, no network requests — three.js 0.187.0 is vendored under `game/vendor/three/`, and every sound is synthesized with WebAudio.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `game/index.html` — the page and the HUD.
- `game/src/main.js` — boot, fixed-step loop, round state machine.
- `game/src/state.js` — the single central game state.
- `game/src/bank.js` — the bank map, collision, waypoints.
- `game/src/weapons.js` — guns, the buy catalogue, ballistics.
- `game/src/player.js` — movement, stamina, crouch, camera.
- `game/src/bots.js` — bot bodies and AI.
- `game/src/combat.js` — shooting, damage, tracers, grenades.
- `game/src/hud.js` — HUD and radar.
- `game/src/audio.js` — procedural sounds.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.

## License

MIT. See LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=w513bxaz&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
