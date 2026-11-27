import { SharedArray } from "k6/data";

export const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
export const PROFILE = __ENV.LOAD_PROFILE || "stress_1000";
export const ABORT_ON_FAIL = __ENV.ABORT_ON_FAIL === "true";

export const PROFILES = {
  smoke: [
    { duration: "10s", target: 10 },
    { duration: "20s", target: 25 },
    { duration: "10s", target: 0 },
  ],
  load: [
    { duration: "30s", target: 100 },
    { duration: "1m", target: 300 },
    { duration: "1m", target: 500 },
    { duration: "30s", target: 0 },
  ],
  stress_1000: [
    { duration: "25s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "40s", target: 500 },
    { duration: "45s", target: 1000 },
    { duration: "15s", target: 0 },
  ],
  spike_1000: [
    { duration: "20s", target: 50 },
    { duration: "15s", target: 1000 },
    { duration: "1m", target: 1000 },
    { duration: "20s", target: 0 },
  ],
};

export function getStages(defaultProfile = "stress_1000") {
  if (__ENV.LOAD_VUS) {
    const vus = Number(__ENV.LOAD_VUS);
    const hold = __ENV.LOAD_DURATION || "25s";
    return [
      { duration: "5s", target: vus },
      { duration: hold, target: vus },
      { duration: "5s", target: 0 },
    ];
  }
  const key = __ENV.LOAD_PROFILE || defaultProfile;
  const stages = PROFILES[key];
  if (!stages) {
    throw new Error(
      `Unknown LOAD_PROFILE="${key}". Valid profiles: ${Object.keys(PROFILES).join(", ")}`
    );
  }
  return stages;
}

export function loadFixtures() {
  return new SharedArray("loadtest_fixtures", () => {
    const raw = open("../.generated/fixtures.json").replace(/^\uFEFF/, "");
    return [JSON.parse(raw)];
  })[0];
}

export function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export function buildThresholds({ abortOnFail = ABORT_ON_FAIL } = {}) {
  return {
    http_req_failed: [
      {
        threshold: "rate<0.02",
        abortOnFail,
        delayAbortEval: "15s",
      },
    ],
    http_req_duration: [
      {
        threshold: "p(95)<1500",
        abortOnFail,
        delayAbortEval: "15s",
      },
      "p(99)<3500",
    ],
  };
}
