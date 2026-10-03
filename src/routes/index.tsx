import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { buildFleet, fmtT, PARAMS, PARAM_LABEL, type FlightReport, type Param } from "@/lib/fdm";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FDM Anomaly Detector — Flight Data Monitoring & FOQA" },
      {
        name: "description",
        content:
          "Flight data monitoring tool that learns a phase-conditioned baseline from normal flights and flags anomalies with multivariate scoring and FOQA exceedance rules.",
      },
      { property: "og:title", content: "FDM Anomaly Detector" },
      {
        property: "og:description",
        content: "Unsupervised anomaly detection + FOQA exceedance events over recorded flight data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const RISK_STYLE: Record<FlightReport["risk"], string> = {
  NORMAL: "border-primary/40 text-primary",
  WATCH: "border-amber-500/60 text-amber-400",
  REVIEW: "border-destructive/60 text-destructive",
};

function Index() {
  const [seed, setSeed] = useState(42);
  const { baseline, reports } = useMemo(() => buildFleet(seed), [seed]);
  const [sel, setSel] = useState(0);
  const [param, setParam] = useState<Param>("vs");
  const rep = reports[Math.min(sel, reports.length - 1)] ?? reports[0]!;

  const flagged = reports.filter((r) => r.risk !== "NORMAL").length;
  const tp = reports.filter((r) => r.risk !== "NORMAL" && r.flight.injected.length).length;
  const fn = reports.filter((r) => r.risk === "NORMAL" && r.flight.injected.length).length;

  return (
    <div className="min-h-screen bg-background font-mono text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-widest text-primary">FDM ANOMALY DETECTOR</h1>
            <p className="text-xs text-muted-foreground">
              flight data monitoring · phase-conditioned baseline · FOQA exceedances
            </p>
          </div>
          <button
            onClick={() => {
              setSeed((s) => s + 1);
              setSel(0);
            }}
            className="rounded border border-border bg-secondary px-3 py-1 text-xs tracking-wider hover:bg-accent"
          >
            ↻ NEW FLEET BATCH
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-6 lg:grid-cols-[320px_1fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-bold tracking-widest text-muted-foreground">FLIGHTS ({reports.length})</h2>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[10px]">
            <Kpi label="FLAGGED" v={flagged} />
            <Kpi label="DETECTED" v={tp} />
            <Kpi label="MISSED" v={fn} />
          </div>
          <ul className="space-y-1">
            {reports.map((r, i) => (
              <li key={r.flight.id + i}>
                <button
                  onClick={() => setSel(i)}
                  className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-xs ${
                    i === sel ? "bg-accent" : "bg-secondary/40"
                  } ${RISK_STYLE[r.risk]}`}
                >
                  <span>
                    <b>{r.flight.id}</b> <span className="text-muted-foreground">{r.flight.route}</span>
                  </span>
                  <span className="text-[10px] font-bold">{r.risk}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Baseline trained on 40 nominal flights · threshold {baseline.threshold.toFixed(2)} (p99.5)
          </p>
        </section>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold tracking-widest text-muted-foreground">
                ANOMALY SCORE — {rep.flight.id}
              </h2>
              <div className="flex gap-3 text-[11px]">
                <span>max <b className="text-primary">{rep.maxScore.toFixed(2)}</b></span>
                <span>anomalous <b className="text-primary">{(rep.anomalyRatio * 100).toFixed(1)}%</b></span>
              </div>
            </div>
            <Chart values={rep.scored.map((s) => s.score)} threshold={baseline.threshold} flags={rep.scored.map((s) => s.anomalous)} />
            <PhaseStrip rep={rep} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap gap-1">
              {PARAMS.map((p) => (
                <button
                  key={p}
                  onClick={() => setParam(p)}
                  className={`rounded border border-border px-2 py-0.5 text-[10px] ${p === param ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                >
                  {PARAM_LABEL[p]}
                </button>
              ))}
            </div>
            <Chart values={rep.scored.map((s) => s[param])} flags={rep.scored.map((s) => s.anomalous && s.topParam === param)} />
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">FOQA EVENTS</h2>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-[11px]">
                {rep.events.length === 0 && <li className="text-muted-foreground">No exceedances.</li>}
                {rep.events.map((e, i) => (
                  <li key={i} className="flex gap-2 rounded bg-secondary/40 px-2 py-1">
                    <span className={e.level === 3 ? "text-destructive" : e.level === 2 ? "text-amber-400" : "text-primary"}>L{e.level}</span>
                    <span className="text-muted-foreground">{fmtT(e.t)}</span>
                    <span className="flex-1">{e.rule}</span>
                    <span>{e.value}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">TOP CONTRIBUTORS</h2>
              <Contributors rep={rep} />
              <p className="mt-3 text-[10px] text-muted-foreground">
                Ground truth (injected): {rep.flight.injected.join(", ") || "none"}
              </p>
            </section>
          </div>
        </div>
      </main>
      <footer className="border-t border-border px-6 py-3 text-center text-[11px] text-muted-foreground">
        Synthetic data for research/demo purposes — not a certified FDM system.
      </footer>
    </div>
  );
}

function Kpi({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-border bg-secondary/50 py-1">
      <div className="text-base font-bold text-primary">{v}</div>
      <div className="tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function Chart({ values, threshold, flags }: { values: number[]; threshold?: number; flags: boolean[] }) {
  const W = 800, H = 140;
  const min = Math.min(...values, threshold ?? Infinity);
  const max = Math.max(...values, threshold ?? -Infinity);
  const y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 16);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" preserveAspectRatio="none">
      {threshold !== undefined && (
        <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} className="stroke-destructive" strokeDasharray="6 4" strokeWidth={1} />
      )}
      <path d={d} fill="none" className="stroke-primary" strokeWidth={1.5} />
      {values.map((v, i) => flags[i] ? <circle key={i} cx={x(i)} cy={y(v)} r={3} className="fill-destructive" /> : null)}
    </svg>
  );
}

function PhaseStrip({ rep }: { rep: FlightReport }) {
  const segs: { phase: string; n: number }[] = [];
  for (const s of rep.scored) {
    const last = segs[segs.length - 1];
    if (last && last.phase === s.phase) last.n++;
    else segs.push({ phase: s.phase, n: 1 });
  }
  return (
    <div className="mt-1 flex text-[9px] text-muted-foreground">
      {segs.map((s, i) => (
        <div key={i} style={{ flex: s.n }} className="truncate border-l border-border pl-1">{s.phase}</div>
      ))}
    </div>
  );
}

function Contributors({ rep }: { rep: FlightReport }) {
  const counts = new Map<Param, number>();
  rep.scored.filter((s) => s.anomalous).forEach((s) => counts.set(s.topParam, (counts.get(s.topParam) ?? 0) + 1));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0) || 1;
  if (!rows.length) return <p className="text-[11px] text-muted-foreground">No anomalous samples.</p>;
  return (
    <div className="space-y-2">
      {rows.map(([p, n]) => (
        <div key={p}>
          <div className="mb-1 flex justify-between text-[11px]"><span>{PARAM_LABEL[p]}</span><span>{n}</span></div>
          <div className="h-1.5 rounded bg-secondary"><div className="h-full rounded bg-destructive" style={{ width: `${(n / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
