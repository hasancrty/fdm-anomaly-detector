# FDM Anomaly Detector

Flight Data Monitoring (FDM / FOQA) dashboard that learns what a "normal" flight looks like and flags recordings that deviate from it.

## Why
Airlines record hundreds of parameters per flight, but analysts only look at a fraction. Fixed exceedance rules catch known events; unsupervised scoring catches the *unknown* ones (slow EGT drift, unusual energy states) before they become incidents.

## How it works
- **Data** – synthetic QAR-like recordings (IAS, V/S, pitch, bank, EGT, N1, g-load) at 10 s resolution across six flight phases. Faults can be injected: unstable approach, hard landing, EGT drift, steep bank, overspeed.
- **Baseline** – per-phase mean / std learned from 40 nominal flights.
- **Anomaly score** – RMS of standardized residuals (diagonal Mahalanobis distance). Threshold = 99.5th percentile of training scores.
- **FOQA rules** – classic level 1-3 exceedances (sink rate, Vapp+15, hard landing, bank > 33°, VMO, EGT trend).
- **Triage** – each flight is rated NORMAL / WATCH / REVIEW; detection is evaluated against the injected ground truth.

## Stack
React 19 · TypeScript · TanStack Start · Tailwind CSS

## Run
```bash
bun install
bun run dev
```

## Roadmap
- Replace synthetic data with real ADS-B tracks (OpenSky)
- Full-covariance Mahalanobis and an LSTM autoencoder for temporal patterns

> Research/demo project — not a certified FDM system.
