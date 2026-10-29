// Glicko-2 rating system (Mark Glickman, http://www.glicko.net/glicko/glicko2.pdf).
// Each game is its own rating period, the way Lichess does it.
// Shared by the browser (guest play) and the Cloudflare Worker (accounts).

const SCALE = 173.7178;
const TAU = 0.5;
const EPS = 1e-6;
export const MIN_RD = 45;
export const MAX_RD = 350;
export const MAX_VOL = 0.1;
export const PROVISIONAL_RD = 110;

export function newRating(r = 1500, rd = MAX_RD, vol = 0.06) {
  return { r, rd, vol, n: 0 };
}

export function expected(r, opp) {
  return 1 / (1 + Math.pow(10, (opp - r) / 400));
}

// player: {r, rd, vol}; results: [{r, rd, score}] with score 1, 0.5 or 0.
export function rate(player, results) {
  const mu = (player.r - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  if (!results.length) {
    const p = Math.sqrt(phi * phi + sigma * sigma);
    return { r: player.r, rd: Math.min(MAX_RD, p * SCALE), vol: sigma };
  }
  let vInv = 0;
  let dSum = 0;
  for (const o of results) {
    const muJ = (o.r - 1500) / SCALE;
    const phiJ = o.rd / SCALE;
    const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
    const E = 1 / (1 + Math.exp(-g * (mu - muJ)));
    vInv += g * g * E * (1 - E);
    dSum += g * (o.score - E);
  }
  const v = 1 / vInv;
  const delta = v * dSum;
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPS && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const sigmaP = Math.min(MAX_VOL, Math.exp(A / 2));
  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * dSum;
  return {
    r: muP * SCALE + 1500,
    rd: Math.max(MIN_RD, Math.min(MAX_RD, phiP * SCALE)),
    vol: sigmaP,
  };
}

// Apply one result and return the new rating object (with game count).
export function applyResult(rating, opp, score) {
  const next = rate(rating, [{ r: opp.r, rd: opp.rd, score }]);
  return { ...rating, ...next, n: (rating.n || 0) + 1 };
}

export function isProvisional(rating) {
  return !rating || rating.rd > PROVISIONAL_RD;
}

// Starting points for the "how much have you played" question.
export const STARTS = [
  { id: 'new', label: 'I know how the pieces move', r: 400 },
  { id: 'some', label: 'I play now and then', r: 800 },
  { id: 'lots', label: 'I play a lot, online or with friends', r: 1200 },
  { id: 'club', label: 'I play in a club or in tournaments', r: 1600 },
];
