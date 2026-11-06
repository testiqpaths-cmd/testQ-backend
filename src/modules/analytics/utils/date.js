export const buildDateFilter = (startDate, endDate) => {
  
  if (!startDate && !endDate) return {};

  const filter = {};
  
  
  if (startDate) {
    filter.$gte = new Date(startDate);
  }

  if (endDate) {
    filter.$lte = new Date(endDate);
  }

  return filter;
};

export const getIsoWeekDetails = (inputDate) => {
  const raw = inputDate instanceof Date ? inputDate : new Date(inputDate);
  const d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  // Set to Thursday in current week: Thursday determines the ISO week-year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const weekKey = `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
  const label = `Week ${weekNum}`;
  return { isoYear, weekNum, weekKey, label };
};

export const getWeekNumber = (date) => {
  return getIsoWeekDetails(date).weekNum;
};
