import * as service from "./testSeries.service.js";

export const createSeries = async (req, res) => {
  const series = await service.createSeries(req.body, req.user);
  res.status(201).json({ success: true, data: series });
  
};



export const updateSeries = async (req, res) => {
  const series = await service.updateSeries(req.params.id, req.body);
  res.json({ success: true, data: series });
};

export const deleteSeries = async (req, res) => {
  await service.deleteSeries(req.params.id);
  res.json({ success: true });
};

export const getSeries = async (req, res) => {
  const series = await service.getSeriesById(req.params.id);
  res.json({ success: true, data: series });
};
