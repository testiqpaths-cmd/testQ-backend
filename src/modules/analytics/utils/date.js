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
