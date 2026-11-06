import logger from "../../../config/logger.js";

const telemetryState = {
  totalRequests: 0,
  fallbackCount: 0,
  missingSnapshotCount: 0,
  malformedSnapshotCount: 0,
  discrepancyCount: 0,
  slowRequestsCount: 0,
  latencySumMs: 0,
  recentEvents: [],
};

const MAX_RECENT_EVENTS = 50;
const FALLBACK_ALERT_THRESHOLD_PERCENT = 5;

const maskId = (id) => {
  if (!id) return "unknown";
  const str = String(id);
  return str.length > 8 ? `${str.slice(0, 4)}...${str.slice(-4)}` : str;
};

function pushEvent(event) {
  telemetryState.recentEvents.push(event);
  if (telemetryState.recentEvents.length > MAX_RECENT_EVENTS) {
    telemetryState.recentEvents.shift();
  }
}

export const recordDashboardRequest = (durationMs, context = "STUDENT") => {
  telemetryState.totalRequests++;
  telemetryState.latencySumMs += durationMs;

  const threshold = context === "ADMIN" || context === "ORGANIZATION" ? 3000 : 1500;
  if (durationMs > threshold) {
    telemetryState.slowRequestsCount++;
    logger.warn(`[DASHBOARD_PERF_ALERT] Slow ${context} request detected: duration=${durationMs.toFixed(2)}ms (>${threshold}ms threshold)`);
  }
};

export const recordSnapshotFallback = ({
  studentId,
  missingCount = 0,
  malformedCount = 0,
  totalAttempts = 0,
  reason = "INCOMPLETE_SNAPSHOTS",
}) => {
  telemetryState.fallbackCount++;
  telemetryState.missingSnapshotCount += missingCount;
  telemetryState.malformedSnapshotCount += malformedCount;

  const masked = maskId(studentId);
  const event = {
    type: "SNAPSHOT_FALLBACK",
    reason,
    studentId: masked,
    missingCount,
    malformedCount,
    totalAttempts,
    timestamp: new Date().toISOString(),
  };
  pushEvent(event);

  logger.warn(
    `[DASHBOARD_SNAPSHOT_FALLBACK] Student ${masked}: ${missingCount} missing, ${malformedCount} malformed out of ${totalAttempts} attempts (${reason}). Raw fallback executed.`
  );

  // Check application-wide fallback rate alert
  if (telemetryState.totalRequests >= 20) {
    const rate = (telemetryState.fallbackCount / telemetryState.totalRequests) * 100;
    if (rate > FALLBACK_ALERT_THRESHOLD_PERCENT) {
      logger.warn(
        `[DASHBOARD_SUSTAINED_FALLBACK_ALERT] Application fallback rate is ${rate.toFixed(1)}% (exceeds ${FALLBACK_ALERT_THRESHOLD_PERCENT}% threshold)`
      );
    }
  }
};

export const recordAnalyticsDiscrepancy = ({
  studentId,
  metric,
  summaryValue,
  computedValue,
}) => {
  telemetryState.discrepancyCount++;
  const masked = maskId(studentId);
  const event = {
    type: "ANALYTICS_DISCREPANCY",
    studentId: masked,
    metric,
    summaryValue,
    computedValue,
    timestamp: new Date().toISOString(),
  };
  pushEvent(event);
  logger.info(
    `[DASHBOARD_ANALYTICS_DRIFT] Student ${masked} ${metric}: summary=${summaryValue} vs computed=${computedValue}.`
  );
};

export const getDashboardTelemetryStats = () => {
  const avgLatency =
    telemetryState.totalRequests > 0
      ? (telemetryState.latencySumMs / telemetryState.totalRequests).toFixed(2)
      : 0;

  return {
    totalRequests: telemetryState.totalRequests,
    fallbackCount: telemetryState.fallbackCount,
    missingSnapshotCount: telemetryState.missingSnapshotCount,
    malformedSnapshotCount: telemetryState.malformedSnapshotCount,
    discrepancyCount: telemetryState.discrepancyCount,
    slowRequestsCount: telemetryState.slowRequestsCount,
    averageLatencyMs: Number(avgLatency),
    fallbackRate:
      telemetryState.totalRequests > 0
        ? ((telemetryState.fallbackCount / telemetryState.totalRequests) * 100).toFixed(2) + "%"
        : "0.00%",
    recentEvents: [...telemetryState.recentEvents],
  };
};

export const resetTelemetryStats = () => {
  telemetryState.totalRequests = 0;
  telemetryState.fallbackCount = 0;
  telemetryState.missingSnapshotCount = 0;
  telemetryState.malformedSnapshotCount = 0;
  telemetryState.discrepancyCount = 0;
  telemetryState.slowRequestsCount = 0;
  telemetryState.latencySumMs = 0;
  telemetryState.recentEvents = [];
};
