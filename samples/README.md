# AegisOps Sample Inputs

These files are intentionally small and synthetic so anyone can try the UI without credentials.

## How To Use

1. Start the app:

```bash
npm install && npm run dev
```

2. Open the UI at `http://127.0.0.1:3000`.
3. Drag & drop one of the sample log files from `samples/logs/` and (optionally) a screenshot from `samples/screenshots/`.
4. Click **Run Analysis**.

## Scenarios

### 1) LLM Latency Spike

- Logs: `samples/logs/llm_latency_spike.txt`
- Screenshot: `samples/screenshots/latency_dashboard.png`

This scenario is designed to produce a SEV1-ish narrative: SLO breach, circuit breaker, queue depth growth, and recovery
after scaling.

### 2) Redis Cluster Crash

- Logs: `samples/logs/redis_cluster_crash.txt`
- Screenshot: `samples/screenshots/redis_dashboard.png`

This scenario includes memory pressure and an OOM kill on the master, triggering a cache miss storm and downstream
saturation.

