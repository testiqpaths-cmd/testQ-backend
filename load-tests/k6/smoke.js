import http from "k6/http";
import { check, group, sleep } from "k6";
import { BASE_URL, authHeaders, getStages } from "./config.js";

// Read-only sanity check safe for staging or controlled off-peak production checks.
// Usage:
//   k6 run load-tests/k6/smoke.js
//   k6 run -e BASE_URL=https://staging.example.com -e AUTH_TOKEN=<jwt> load-tests/k6/smoke.js
export const options = {
  stages: getStages("smoke"),
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "10s" }],
    http_req_duration: [{ threshold: "p(95)<1000", abortOnFail: true, delayAbortEval: "10s" }],
  },
};

export default function () {
  group("Health check", () => {
    const res = http.get(`${BASE_URL}/api`, { tags: { name: "GET /api" } });
    check(res, {
      "health status 200": (r) => r.status === 200,
    });
  });

  const token = __ENV.AUTH_TOKEN;
  if (token) {
    const headers = authHeaders(token);

    group("Authenticated read-only sanity", () => {
      const me = http.get(`${BASE_URL}/api/auth/me`, {
        headers,
        tags: { name: "GET /api/auth/me" },
      });
      check(me, { "me 200": (r) => r.status === 200 });

      const assigned = http.get(`${BASE_URL}/api/test/assigned`, {
        headers,
        tags: { name: "GET /api/test/assigned" },
      });
      check(assigned, { "assigned 200": (r) => r.status === 200 });

      const dashboard = http.get(`${BASE_URL}/api/dashboard/student`, {
        headers,
        tags: { name: "GET /api/dashboard/student" },
      });
      check(dashboard, { "dashboard 200": (r) => r.status === 200 });
    });
  }

  sleep(1);
}
