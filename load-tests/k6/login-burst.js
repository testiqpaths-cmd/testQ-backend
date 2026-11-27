import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { BASE_URL, buildThresholds, getStages, loadFixtures } from "./config.js";

const fixtures = loadFixtures();
const loginLatency = new Trend("login_latency_ms", true);

export const options = {
  stages: getStages("load"),
  thresholds: {
    ...buildThresholds(),
    login_latency_ms: ["p(95)<2500"],
  },
};

export default function () {
  const userIdx = (__VU - 1) % fixtures.users.length;
  const user = fixtures.users[userIdx];

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: user.email,
      password: fixtures.password,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "POST /api/auth/login" },
    }
  );

  loginLatency.add(res.timings.duration);

  check(res, {
    "login 200": (r) => r.status === 200,
    "login returns accessToken": (r) => Boolean(r.body && r.status === 200 && r.json("accessToken")),
  });

  sleep(1);
}
