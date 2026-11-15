// audio.js — every sound is synthesized with WebAudio: no audio files, no
// network, nothing to download. A shot is filtered noise, a reload is clicks,
// a plant is a beep pattern, an explosion is noise plus a low sine drop.
export function createAudio() {
  let ctx = null;
  let master = null;
  const api = {
    enabled: false,
    unlock() {
      if (ctx) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
        api.enabled = true;
      } catch (e) { /* headless or blocked: stay silent */ }
    },
    setMuted(m) { if (master) master.gain.value = m ? 0 : 0.35; },
  };

  function noiseBuffer(dur) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }
  function tone(freq, dur, gain, slideTo = null, type = 'sine') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }
  function click(delay, freq = 1800, gain = 0.2) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.04);
  }

  // volume scales with distance for sounds the player did not make
  api.shot = (dist = 0) => { const v = Math.max(0.08, 1 - dist / 55); burst(0.12, 2400, 0.5 * v); tone(160, 0.08, 0.25 * v, 60); };
  api.dryFire = () => click(0, 2400, 0.12);
  api.reload = () => { click(0.05, 1400); click(0.35, 1000); click(0.7, 1800, 0.25); };
  api.hit = () => tone(2200, 0.05, 0.18, null, 'square');
  api.kill = () => { tone(880, 0.09, 0.2); tone(1320, 0.12, 0.18); };
  api.hurt = () => { burst(0.15, 500, 0.3); tone(110, 0.15, 0.25, 70); };
  api.step = () => burst(0.05, 700, 0.06);
  api.plantBeep = () => tone(1200, 0.07, 0.2, null, 'square');
  api.planted = () => { tone(660, 0.12, 0.22); tone(990, 0.18, 0.22); };
  api.explosion = () => { burst(0.9, 300, 0.9); tone(90, 0.8, 0.5, 30); };
  api.defuseBeep = () => tone(1500, 0.06, 0.16, null, 'square');
  api.roundWin = () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.2), i * 110)); };
  api.roundLose = () => { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.18), i * 130)); };
  api.buy = () => { tone(1200, 0.05, 0.15, null, 'square'); tone(1600, 0.07, 0.15, null, 'square'); };
  api.deny = () => tone(220, 0.12, 0.2, 160, 'square');
  api.grenadePin = () => click(0, 2000, 0.15);
  return api;
}
