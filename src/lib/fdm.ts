// ============================================================
// FDM / FOQA Anomaly Detector
// Flight Data Monitoring: synthesizes multi-parameter flight
// recordings, learns a phase-conditioned baseline from normal
// flights and flags anomalies with (a) multivariate statistical
// scoring and (b) classic FOQA exceedance rules.
// ============================================================

export type Phase = "TAKEOFF" | "CLIMB" | "CRUISE" | "DESCENT" | "APPROACH" | "LANDING";
export const PHASES: Phase[] = ["TAKEOFF", "CLIMB", "CRUISE", "DESCENT", "APPROACH", "LANDING"];

export const PARAMS = ["ias", "vs", "pitch", "bank", "egt", "n1", "gload"] as const;
export type Param = (typeof PARAMS)[number];

export const PARAM_LABEL: Record<Param, string> = {
  ias: "IAS (kt)",
  vs: "V/S (fpm)",
  pitch: "Pitch (°)",
  bank: "Bank (°)",
  egt: "EGT (°C)",
  n1: "N1 (%)",
  gload: "G-load",
};

export interface Sample {
  t: number;
  phase: Phase;
  ias: number;
  vs: number;
  pitch: number;
  bank: number;
  egt: number;
  n1: number;
  gload: number;
}

export interface Flight {
  id: string;
  route: string;
  samples: Sample[];
  injected: string[]; // ground truth of injected faults (for evaluation)
}

export interface FoqaEvent {
  t: number;
  phase: Phase;
  rule: string;
  level: 1 | 2 | 3;
  value: string;
}

export interface ScoredSample extends Sample {
  score: number; // multivariate anomaly score
  topParam: Param;
  anomalous: boolean;
}

export interface FlightReport {
  flight: Flight;
  scored: ScoredSample[];
  events: FoqaEvent[];
  maxScore: number;
  anomalyRatio: number;
  risk: "NORMAL" | "WATCH" | "REVIEW";
}

// ---------------- deterministic RNG ----------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const NOMINAL: Record<Phase, Omit<Sample, "t" | "phase">> = {
  TAKEOFF: { ias: 150, vs: 1500, pitch: 12, bank: 0, egt: 880, n1: 94, gload: 1.1 },
  CLIMB: { ias: 280, vs: 2200, pitch: 8, bank: 4, egt: 820, n1: 90, gload: 1.0 },
  CRUISE: { ias: 270, vs: 0, pitch: 2.5, bank: 2, egt: 700, n1: 82, gload: 1.0 },
  DESCENT: { ias: 290, vs: -1800, pitch: -1, bank: 5, egt: 520, n1: 40, gload: 1.0 },
  APPROACH: { ias: 145, vs: -750, pitch: 2.5, bank: 6, egt: 560, n1: 55, gload: 1.0 },
  LANDING: { ias: 135, vs: -200, pitch: 4, bank: 1, egt: 500, n1: 35, gload: 1.25 },
};
const SPREAD: Record<Param, number> = {
  ias: 5, vs: 180, pitch: 1, bank: 2, egt: 12, n1: 1.5, gload: 0.04,
};
const PHASE_LEN: Record<Phase, number> = {
  TAKEOFF: 10, CLIMB: 30, CRUISE: 60, DESCENT: 30, APPROACH: 25, LANDING: 8,
};

type Fault = "UNSTABLE_APPROACH" | "HARD_LANDING" | "EGT_DRIFT" | "STEEP_BANK" | "OVERSPEED";
export const FAULTS: Fault[] = ["UNSTABLE_APPROACH", "HARD_LANDING", "EGT_DRIFT", "STEEP_BANK", "OVERSPEED"];

const AIRPORTS = ["LTFM", "LTAC", "LTAI", "LTBJ", "LTFJ", "EDDF", "EGLL", "LFPG", "OMDB"];

export function generateFlight(seed: number, faults: Fault[] = []): Flight {
  const r = rng(seed);
  const samples: Sample[] = [];
  let t = 0;
  for (const phase of PHASES) {
    const n = PHASE_LEN[phase];
    for (let i = 0; i < n; i++) {
      const base = NOMINAL[phase];
      const s: Sample = { t, phase } as Sample;
      for (const p of PARAMS) s[p] = base[p] + gauss(r) * SPREAD[p];
      const prog = i / n;

      if (faults.includes("UNSTABLE_APPROACH") && phase === "APPROACH" && prog > 0.4) {
        s.vs -= 900 + r() * 400;
        s.ias += 18 + r() * 6;
      }
      if (faults.includes("HARD_LANDING") && phase === "LANDING" && i === 2) {
        s.gload = 2.05 + r() * 0.3;
        s.vs = -780;
      }
      if (faults.includes("EGT_DRIFT") && phase === "CRUISE") s.egt += prog * 85;
      if (faults.includes("STEEP_BANK") && phase === "CLIMB" && i > 12 && i < 18) s.bank = 38 + r() * 6;
      if (faults.includes("OVERSPEED") && phase === "DESCENT" && i > 10 && i < 16) s.ias = 345 + r() * 8;

      samples.push(s);
      t += 10; // 10 s resolution (downsampled QAR)
    }
  }
  const a = AIRPORTS[Math.floor(r() * AIRPORTS.length)] ?? "LTFM";
  let b = AIRPORTS[Math.floor(r() * AIRPORTS.length)] ?? "LTAC";
  if (a === b) b = "LTBJ";
  return { id: `TK${1000 + (seed % 9000)}`, route: `${a}-${b}`, samples, injected: faults };
}

// ---------------- baseline model ----------------
export interface Baseline {
  mean: Record<Phase, Record<Param, number>>;
  std: Record<Phase, Record<Param, number>>;
  threshold: number;
}

export function trainBaseline(flights: Flight[]): Baseline {
  const mean = {} as Baseline["mean"];
  const std = {} as Baseline["std"];
  for (const ph of PHASES) {
    const rows = flights.flatMap((f) => f.samples.filter((s) => s.phase === ph));
    mean[ph] = {} as Record<Param, number>;
    std[ph] = {} as Record<Param, number>;
    for (const p of PARAMS) {
      const m = rows.reduce((a, s) => a + s[p], 0) / Math.max(1, rows.length);
      const v = rows.reduce((a, s) => a + (s[p] - m) ** 2, 0) / Math.max(1, rows.length - 1);
      mean[ph][p] = m;
      std[ph][p] = Math.sqrt(v) || 1;
    }
  }
  const b: Baseline = { mean, std, threshold: 0 };
  // threshold = 99.5th percentile of training scores
  const scores = flights.flatMap((f) => f.samples.map((s) => scoreSample(b, s).score)).sort((x, y) => x - y);
  b.threshold = scores[Math.floor(scores.length * 0.995)] ?? 4;
  return b;
}

// RMS of standardized residuals (diagonal Mahalanobis distance / sqrt(d))
export function scoreSample(b: Baseline, s: Sample): { score: number; topParam: Param } {
  let sum = 0;
  let top: Param = "ias";
  let topZ = 0;
  for (const p of PARAMS) {
    const z = Math.abs((s[p] - b.mean[s.phase][p]) / b.std[s.phase][p]);
    sum += z * z;
    if (z > topZ) {
      topZ = z;
      top = p;
    }
  }
  return { score: Math.sqrt(sum / PARAMS.length), topParam: top };
}

// ---------------- FOQA exceedance rules ----------------
export function foqaEvents(f: Flight): FoqaEvent[] {
  const ev: FoqaEvent[] = [];
  for (const s of f.samples) {
    if (s.phase === "APPROACH" && s.vs < -1250)
      ev.push({ t: s.t, phase: s.phase, rule: "Sink rate high (approach)", level: s.vs < -1550 ? 3 : 2, value: `${Math.round(s.vs)} fpm` });
    if (s.phase === "APPROACH" && s.ias > NOMINAL.APPROACH.ias + 15)
      ev.push({ t: s.t, phase: s.phase, rule: "Vapp +15 kt exceedance", level: 2, value: `${Math.round(s.ias)} kt` });
    if (s.gload > 1.8)
      ev.push({ t: s.t, phase: s.phase, rule: "Hard landing", level: s.gload > 2.1 ? 3 : 2, value: `${s.gload.toFixed(2)} g` });
    if (Math.abs(s.bank) > 33)
      ev.push({ t: s.t, phase: s.phase, rule: "Excessive bank angle", level: 2, value: `${Math.abs(s.bank).toFixed(0)}°` });
    if (s.ias > 340)
      ev.push({ t: s.t, phase: s.phase, rule: "VMO exceedance", level: 3, value: `${Math.round(s.ias)} kt` });
    if (s.egt > 760 && s.phase === "CRUISE")
      ev.push({ t: s.t, phase: s.phase, rule: "EGT trend exceedance", level: 1, value: `${Math.round(s.egt)} °C` });
  }
  return ev;
}

export function analyzeFlight(b: Baseline, f: Flight): FlightReport {
  const scored = f.samples.map((s) => {
    const { score, topParam } = scoreSample(b, s);
    return { ...s, score, topParam, anomalous: score > b.threshold };
  });
  const events = foqaEvents(f);
  const maxScore = Math.max(...scored.map((s) => s.score));
  const anomalyRatio = scored.filter((s) => s.anomalous).length / scored.length;
  const lvl3 = events.some((e) => e.level === 3);
  const risk = lvl3 || anomalyRatio > 0.06 ? "REVIEW" : anomalyRatio > 0.03 || events.some((e) => e.level >= 2) ? "WATCH" : "NORMAL";
  return { flight: f, scored, events, maxScore, anomalyRatio, risk };
}

// Build a fleet: normal flights for training + a mixed evaluation set
export function buildFleet(seed = 42) {
  const r = rng(seed);
  const train = Array.from({ length: 40 }, (_, i) => generateFlight(seed * 100 + i));
  const baseline = trainBaseline(train);
  const evalFlights: Flight[] = Array.from({ length: 14 }, (_, i) => {
    const faults: Fault[] = r() < 0.5 ? [FAULTS[Math.floor(r() * FAULTS.length)] ?? "EGT_DRIFT"] : [];
    if (r() < 0.15) faults.push(FAULTS[Math.floor(r() * FAULTS.length)] ?? "HARD_LANDING");
    return generateFlight(seed * 1000 + i * 7 + 3, [...new Set(faults)]);
  });
  const reports = evalFlights.map((f) => analyzeFlight(baseline, f));
  return { baseline, reports };
}

export function fmtT(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
