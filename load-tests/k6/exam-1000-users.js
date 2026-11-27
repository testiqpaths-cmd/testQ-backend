import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { BASE_URL, authHeaders, buildThresholds, getStages, loadFixtures } from "./config.js";

const fixtures = loadFixtures();

// Per-flow custom metrics to pinpoint which subsystem degrades first
const loginMs = new Trend("flow_login_ms", true);
const dashboardMs = new Trend("flow_dashboard_ms", true);
const leaderboardMs = new Trend("flow_leaderboard_ms", true);
const examStartMs = new Trend("flow_exam_start_ms", true);
const saveAnswerMs = new Trend("flow_save_answer_ms", true);
const submitAttemptMs = new Trend("flow_submit_attempt_ms", true);
const flowErrors = new Rate("flow_error_rate");

export const options = {
  stages: getStages("stress_1000"),
  thresholds: {
    ...buildThresholds(),
    flow_error_rate: ["rate<0.02"],
    flow_dashboard_ms: ["p(95)<1500"],
    flow_exam_start_ms: ["p(95)<1500"],
    flow_save_answer_ms: ["p(95)<1000"],
    flow_submit_attempt_ms: ["p(95)<2000"],
  },
};

function recordStatus(ok) {
  flowErrors.add(!ok);
}

function runBrowseAndDashboard(user) {
  const headers = authHeaders(user.accessToken);

  group("Browse & Dashboard", () => {
    const me = http.get(`${BASE_URL}/api/auth/me`, {
      headers,
      tags: { name: "GET /api/auth/me" },
    });
    recordStatus(check(me, { "me 200": (r) => r.status === 200 }));

    const assigned = http.get(`${BASE_URL}/api/test/assigned`, {
      headers,
      tags: { name: "GET /api/test/assigned" },
    });
    recordStatus(check(assigned, { "assigned 200": (r) => r.status === 200 }));

    const dash = http.get(`${BASE_URL}/api/dashboard/student`, {
      headers,
      tags: { name: "GET /api/dashboard/student" },
      responseCallback: http.expectedStatuses(200, 402),
    });
    dashboardMs.add(dash.timings.duration);
    recordStatus(
      check(dash, { "dashboard 200 or 402(plan gate)": (r) => r.status === 200 || r.status === 402 })
    );

    const lb = http.get(`${BASE_URL}/api/leaderboard/test/${fixtures.testId}`, {
      headers,
      tags: { name: "GET /api/leaderboard/test/:testId" },
      responseCallback: http.expectedStatuses(200, 402, 403),
    });
    leaderboardMs.add(lb.timings.duration);
    recordStatus(
      check(lb, {
        "leaderboard 200 or 402/403(plan gate)": (r) =>
          r.status === 200 || r.status === 402 || r.status === 403,
      })
    );

    const notif = http.get(`${BASE_URL}/api/notifications`, {
      headers,
      tags: { name: "GET /api/notifications" },
    });
    recordStatus(check(notif, { "notifications 200": (r) => r.status === 200 }));
  });
}

function runExamAttemptJourney(user) {
  const headers = authHeaders(user.accessToken);
  let attemptId = null;

  group("Exam Journey (Start -> Save -> Submit -> Result)", () => {
    const testDetails = http.get(`${BASE_URL}/api/test/tests/${fixtures.testId}`, {
      headers,
      tags: { name: "GET /api/test/tests/:id" },
    });
    recordStatus(check(testDetails, { "get test 200": (r) => r.status === 200 }));

    const startRes = http.post(
      `${BASE_URL}/api/test-attempts/starttest/${fixtures.testId}`,
      JSON.stringify({}),
      {
        headers,
        tags: { name: "POST /api/test-attempts/starttest/:testId" },
        responseCallback: http.expectedStatuses(201, 409),
      }
    );
    examStartMs.add(startRes.timings.duration);

    const startOk = check(startRes, {
      "starttest 201 or 409(resume)": (r) => r.status === 201 || r.status === 409,
    });
    recordStatus(startOk);

    if (!startRes.body || (startRes.status !== 201 && startRes.status !== 409)) {
      return;
    }

    attemptId = startRes.json("data.attemptId");
    if (!attemptId) {
      return;
    }

    sleep(0.5);

    // Save 3 answers sequentially with realistic short think time
    const questionsToAnswer = fixtures.questions.slice(0, 3);
    for (const q of questionsToAnswer) {
      const saveRes = http.post(
        `${BASE_URL}/api/test-attempts/saveanswer/${attemptId}`,
        JSON.stringify({
          questionId: q.id,
          selectedOption: q.correctAnswer,
          timeSpentMs: 1200,
        }),
        { headers, tags: { name: "POST /api/test-attempts/saveanswer/:attemptId" } }
      );
      saveAnswerMs.add(saveRes.timings.duration);
      recordStatus(check(saveRes, { "saveanswer 200": (r) => r.status === 200 }));
      sleep(0.3);
    }

    const submitRes = http.post(
      `${BASE_URL}/api/test-attempts/submitattempt/${attemptId}`,
      JSON.stringify({}),
      { headers, tags: { name: "POST /api/test-attempts/submitattempt/:attemptId" } }
    );
    submitAttemptMs.add(submitRes.timings.duration);
    recordStatus(check(submitRes, { "submitattempt 200": (r) => r.status === 200 }));

    const resultRes = http.get(`${BASE_URL}/api/test-attempts/getattemptresult/${attemptId}`, {
      headers,
      tags: { name: "GET /api/test-attempts/getattemptresult/:attemptId" },
    });
    recordStatus(check(resultRes, { "getattemptresult 200": (r) => r.status === 200 }));
  });
}

function runLoginBurst(user) {
  group("Auth Login", () => {
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
    loginMs.add(res.timings.duration);
    recordStatus(
      check(res, {
        "login 200": (r) => r.status === 200,
        "has token": (r) => Boolean(r.body && r.status === 200 && r.json("accessToken")),
      })
    );
  });
}

export default function () {
  // 1-to-1 VU-to-student mapping avoids partial unique index collisions on IN_PROGRESS attempts
  const user = fixtures.users[(__VU - 1) % fixtures.users.length];
  const roll = Math.random();

  if (roll < 0.45) {
    runExamAttemptJourney(user);
  } else if (roll < 0.85) {
    runBrowseAndDashboard(user);
  } else {
    runLoginBurst(user);
  }

  sleep(0.5 + Math.random());
}
