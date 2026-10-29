// Short synthesized move sounds. No music, no audio files.

let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function knock(freq, gain, dur) {
  const a = ac();
  if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

function tone(freq, dur, gain = 0.06, when = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  const t = a.currentTime + when;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playMove(san) {
  if (!enabled) return;
  if (!san) { knock(1500, 0.9, 0.06); return; }
  if (san.includes('#')) { knock(900, 1.2, 0.09); return; }
  if (san.includes('+')) { knock(1100, 1.1, 0.08); tone(660, 0.12, 0.03); return; }
  if (san.includes('x')) knock(1000, 1.3, 0.09);
  else knock(1500, 0.9, 0.06);
}

export function playEnd() {
  if (!enabled) return;
  knock(700, 1.2, 0.12);
}

export function playError() {
  if (!enabled) return;
  tone(220, 0.15, 0.05);
}

export function unlockAudio() { if (enabled) ac(); }
