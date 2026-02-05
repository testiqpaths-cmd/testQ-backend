export default function scheduleMiddleware(req, res, next) {
  const { scheduleType, startTime, endTime, delayDays, createdAt } = req.test;
  const now = new Date();

  if (scheduleType === "IMMEDIATE") return next();

  if (scheduleType === "DELAYED") {
    const liveAt = new Date(createdAt);
    liveAt.setDate(liveAt.getDate() + delayDays);
    if (now < liveAt) return res.status(403).json({ message: "Test not live yet" });
  }

  if (scheduleType === "FIXED") {
    if (now < startTime || now > endTime) return res.status(403).json({ message: "Outside test window" });
  }

  next();
}
