# TestQ-Portal Industry Load Testing Suite (Up to 1,000 Concurrent Users)

This folder contains an industry-standard **k6** load-testing suite tailored to `testQ-backend` (`Express` + `MongoDB` + `Socket.IO` + `Redis`).

---

## Architecture & Scenarios

| Script | Purpose | Safe on Production? |
|---|---|---|
| `k6/smoke.js` | Read-only sanity & auth check (`10 → 25 VUs`) with `abortOnFail` | Yes (off-peak, read-only) |
| `k6/login-burst.js` | Measures `POST /api/auth/login` (`bcryptjs` CPU bottleneck) | No (Staging / Local only) |
| `k6/exam-1000-users.js` | Full 1,000-VU mixed workload: 45% exam attempt lifecycle (`start -> saveanswer -> submit -> result`), 40% browse/dashboard/leaderboard, 15% login | No (Staging / Local only) |
| `k6/socket-1000-users.js` | 1,000 concurrent Socket.IO `/assigned-tests` authenticated connections | No (Staging / Local only) |

---

## Step-by-Step Guide (Local or Staging — 1,000 Users)

> **Important:** Run full 1,000-user tests against **Local** or a **Production-mirror Staging** server — never directly against a live production database with active students.

### 1. Start Backend Server (in separate terminal)
Make sure `.env` points to your **local or staging** MongoDB & Redis, then start the server in production mode (`node src/server.js`, not `nodemon`):

```bash
cd testQ-backend
npm start
```

### 2. Seed 1,000 Synthetic Students + Benchmark Test
Creates 1,000 test student accounts (`loadtest.student.1..1000@loadtest.testq.local`), 10 MCQ questions, 1 `PUBLIC` test (`maxAttempts: 100000`, `secureBrowserRequired: false`), accepted assignments, and pre-minted JWTs in `load-tests/.generated/fixtures.json`:

```bash
# Local MongoDB:
npm run loadtest:seed

# Remote Staging MongoDB (requires explicit confirmation so you never hit Prod by mistake):
node load-tests/seed-load-test-data.js --confirm-remote
```

### 3. Run Load Tests

1. **Quick Sanity Smoke Test (25 VUs):**
   ```bash
   npm run loadtest:smoke
   ```
2. **Full 1,000-User Step-Ladder Stress Test (`100 → 250 → 500 → 750 → 1000 VUs`):**
   ```bash
   npm run loadtest:1000
   ```
   *(Saves summary JSON and prints per-flow latency: `flow_dashboard_ms`, `flow_exam_start_ms`, `flow_save_answer_ms`, `flow_submit_attempt_ms`, `flow_login_ms`.)*
3. **1,000-User Exam Start Spike Test (`50 → 1000 VUs in 15s`):**
   ```bash
   npm run loadtest:spike1000
   ```
4. **Login CPU Burst Test:**
   ```bash
   npm run loadtest:login
   ```
5. **1,000 Concurrent Socket.IO Connections:**
   ```bash
   npm run loadtest:sockets1000
   ```

To target a **Staging URL** instead of `http://localhost:5000`:
```bash
k6 run -e BASE_URL=https://staging-api.yourdomain.com -e LOAD_PROFILE=stress_1000 load-tests/k6/exam-1000-users.js
```

### 4. Cleanup Synthetic Load-Test Data
Deletes **only** the seeded load-test users, questions, test, assignments, attempts, and notifications:

```bash
npm run loadtest:cleanup
```

---

## Safe Production Sanity Check (Optional)
If you want to verify live production health without risking real users or polluting the DB:
```bash
k6 run -e BASE_URL=https://api.yourdomain.com -e AUTH_TOKEN="<test-student-jwt>" load-tests/k6/smoke.js
```
This runs only `10 → 25` read-only VUs and automatically aborts (`abortOnFail: true`) if error rate > 1% or p95 > 1000ms.

---

## How to Read Results (Finding Your Breaking Point)
- **`http_req_failed` < 2%**: Above 2% means connections, DB pool (`maxPoolSize: 50` in `src/config/db.js`), or reverse proxy limits are saturating.
- **`http_req_duration` p(95) < 1500ms**: Look at the custom `flow_*_ms` metrics to see which specific subsystem failed first:
  - `flow_login_ms` spiking → `bcryptjs` CPU saturation on the Node event loop (consider higher vCPU/clustering or native `bcrypt` / Argon2).
  - `flow_dashboard_ms` spiking → heavy MongoDB aggregation / missing index.
  - `flow_exam_start_ms` / `flow_save_answer_ms` spiking → MongoDB write contention or `maxPoolSize` exhaustion.
