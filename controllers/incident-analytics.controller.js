const analyticsService = require("../services/incident-analytics.service");

const getSafetyAnalytics = async (req, res) => {
  const analytics = await analyticsService.getSafetyAnalytics({
    role: req.auth.role,
    query: req.query,
  });

  return res.status(200).json(analytics);
};

const exportSafetyAnalyticsCsv = async (req, res) => {
  const csv = await analyticsService.exportSafetyAnalyticsCsv({
    role: req.auth.role,
    query: req.query,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="safety-analytics-${timestamp}.csv"`);
  return res.status(200).send(csv);
};

module.exports = {
  getSafetyAnalytics,
  exportSafetyAnalyticsCsv,
};
