export default function scheduleMiddleware(req, res, next) {
  const { scheduleType, startTime, endTime, delayDays, createdAt, createdBy } = req.test;
  const user = req.user;

  if (user.role === "IQPATH_ADMIN") return next();

  const ownerId = createdBy?.userId?.toString();
  const requesterId = String(user._id || user.id || "");
  if (ownerId && requesterId && ownerId === requesterId) {
    return next();
  }

  const now = new Date();

  if (scheduleType === "IMMEDIATE") return next();

  if (scheduleType === "DELAYED") {
    const liveAt = new Date(createdAt);
    liveAt.setDate(liveAt.getDate() + delayDays);
    if (now < liveAt) return res.status(403).json({ message: "Test not live yet" });
  }

  if (scheduleType === "IMMEDIATE" && !req.test.isPublished) {
    return res.status(403).json({ message: "This test is not published yet" });
  }

  if (scheduleType === "FIXED") {
    if (now < startTime) return res.status(403).json({ message: "Test has not started yet" });
    if (now > endTime) return res.status(403).json({ message: "Test has ended" });
  }

  next();
}
