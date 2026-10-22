const { IncidentStatus, Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const AppError = require("../utils/app-error");

const ALLOWED_STATUS = new Set([IncidentStatus.ACTIVE, IncidentStatus.RESOLVED, IncidentStatus.CANCELLED]);
const ALLOWED_TIME_OF_DAY = new Set(["ALL", "NIGHT", "MORNING", "AFTERNOON", "EVENING"]);
const MAX_DATE_RANGE_DAYS = 366;
const MAX_MARKERS = 600;
const MAX_HOTSPOTS = 25;

const pad2 = (value) => String(value).padStart(2, "0");

const csvEscape = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const toCsv = (rows) =>
  rows
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");

const parseDateAtBoundary = (value, boundary) => {
  if (!value) return null;
  if (typeof value !== "string") {
    throw new AppError(400, `${boundary === "start" ? "startDate" : "endDate"} must be a string in YYYY-MM-DD format.`);
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError(400, `${boundary === "start" ? "startDate" : "endDate"} must be in YYYY-MM-DD format.`);
  }
  return boundary === "start"
    ? new Date(`${normalized}T00:00:00.000Z`)
    : new Date(`${normalized}T23:59:59.999Z`);
};

const parseStatuses = (rawStatus) => {
  if (!rawStatus || rawStatus === "ALL") {
    return [IncidentStatus.ACTIVE, IncidentStatus.RESOLVED, IncidentStatus.CANCELLED];
  }

  const values = String(rawStatus)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (!values.length) {
    throw new AppError(400, "status filter is empty.");
  }

  const invalid = values.filter((value) => !ALLOWED_STATUS.has(value));
  if (invalid.length) {
    throw new AppError(400, `Unsupported status values: ${invalid.join(", ")}`);
  }
  return Array.from(new Set(values));
};

const parseTimeOfDay = (value) => {
  if (!value) return "ALL";
  const normalized = String(value).trim().toUpperCase();
  if (!ALLOWED_TIME_OF_DAY.has(normalized)) {
    throw new AppError(400, "timeOfDay must be one of ALL, NIGHT, MORNING, AFTERNOON, EVENING.");
  }
  return normalized;
};

const parseCategory = (value) => {
  if (!value || value === "ALL") return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > 120) {
    throw new AppError(400, "category filter is too long.");
  }
  return normalized;
};

const parseBounds = (query) => {
  const minLat = query.minLat !== undefined ? Number(query.minLat) : null;
  const maxLat = query.maxLat !== undefined ? Number(query.maxLat) : null;
  const minLng = query.minLng !== undefined ? Number(query.minLng) : null;
  const maxLng = query.maxLng !== undefined ? Number(query.maxLng) : null;

  const anyProvided = [minLat, maxLat, minLng, maxLng].some((item) => item !== null);
  if (!anyProvided) return null;

  if ([minLat, maxLat, minLng, maxLng].some((value) => !Number.isFinite(value))) {
    throw new AppError(400, "All map bounds values must be valid numbers.");
  }
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    throw new AppError(400, "Map bounds are out of valid latitude/longitude range.");
  }
  if (minLat > maxLat || minLng > maxLng) {
    throw new AppError(400, "Map bounds minimum values cannot be greater than maximum values.");
  }
  return { minLat, maxLat, minLng, maxLng };
};

const parseCellSize = (value) => {
  if (!value) return 0.01;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.002 || parsed > 0.2) {
    throw new AppError(400, "cellSize must be between 0.002 and 0.2.");
  }
  return parsed;
};

const parseSliderEndAt = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "sliderEndAt must be a valid ISO datetime.");
  }
  return parsed;
};

const resolveGranularity = (startDate, endDate, requested) => {
  if (requested) {
    const normalized = String(requested).trim().toLowerCase();
    if (["hour", "day", "week", "month"].includes(normalized)) {
      return normalized;
    }
    throw new AppError(400, "granularity must be one of hour, day, week, month.");
  }
  const rangeDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  if (rangeDays <= 3) return "hour";
  if (rangeDays <= 90) return "day";
  if (rangeDays <= 180) return "week";
  return "month";
};

const parseFilters = (query) => {
  const endDate = parseDateAtBoundary(query.endDate, "end") || new Date();
  const startDate =
    parseDateAtBoundary(query.startDate, "start") ||
    new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (startDate > endDate) {
    throw new AppError(400, "startDate cannot be after endDate.");
  }
  const rangeDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    throw new AppError(400, `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`);
  }

  const statuses = parseStatuses(query.status);
  const category = parseCategory(query.category);
  const timeOfDay = parseTimeOfDay(query.timeOfDay);
  const bounds = parseBounds(query);
  const cellSize = parseCellSize(query.cellSize);
  const sliderEndAt = parseSliderEndAt(query.sliderEndAt);
  const granularity = resolveGranularity(startDate, endDate, query.granularity);

  return {
    timezone: "UTC",
    startDate,
    endDate,
    statuses,
    category,
    timeOfDay,
    bounds,
    cellSize,
    sliderEndAt,
    granularity,
  };
};

const timeOfDaySql = (timeOfDay) => {
  if (timeOfDay === "ALL") return Prisma.sql`TRUE`;
  if (timeOfDay === "NIGHT") {
    return Prisma.sql`(EXTRACT(HOUR FROM point_time) >= 0 AND EXTRACT(HOUR FROM point_time) < 6)`;
  }
  if (timeOfDay === "MORNING") {
    return Prisma.sql`(EXTRACT(HOUR FROM point_time) >= 6 AND EXTRACT(HOUR FROM point_time) < 12)`;
  }
  if (timeOfDay === "AFTERNOON") {
    return Prisma.sql`(EXTRACT(HOUR FROM point_time) >= 12 AND EXTRACT(HOUR FROM point_time) < 18)`;
  }
  return Prisma.sql`(EXTRACT(HOUR FROM point_time) >= 18 AND EXTRACT(HOUR FROM point_time) < 24)`;
};

const buildIncidentPointCte = (filters, includeSliderWindow) => {
  const conditions = [
    Prisma.sql`i."createdAt" >= ${filters.startDate}`,
    Prisma.sql`i."createdAt" <= ${filters.endDate}`,
    Prisma.sql`i.status IN (${Prisma.join(filters.statuses)})`,
  ];

  if (filters.category) {
    conditions.push(Prisma.sql`i.title = ${filters.category}`);
  }

  const windowConditions = [
    Prisma.sql`fp.latitude IS NOT NULL`,
    Prisma.sql`fp.longitude IS NOT NULL`,
    Prisma.sql`fp.latitude BETWEEN -90 AND 90`,
    Prisma.sql`fp.longitude BETWEEN -180 AND 180`,
    Prisma.sql`point_time >= ${filters.startDate}`,
    Prisma.sql`point_time <= ${filters.endDate}`,
    timeOfDaySql(filters.timeOfDay),
  ];

  if (includeSliderWindow && filters.sliderEndAt) {
    windowConditions.push(Prisma.sql`point_time <= ${filters.sliderEndAt}`);
  }

  if (filters.bounds) {
    windowConditions.push(Prisma.sql`fp.latitude BETWEEN ${filters.bounds.minLat} AND ${filters.bounds.maxLat}`);
    windowConditions.push(Prisma.sql`fp.longitude BETWEEN ${filters.bounds.minLng} AND ${filters.bounds.maxLng}`);
  }

  return Prisma.sql`
    WITH first_points AS (
      SELECT
        il."incidentId",
        il.latitude,
        il.longitude,
        il.address,
        COALESCE(il."locationTimestamp", il."createdAt") AS point_time,
        ROW_NUMBER() OVER (PARTITION BY il."incidentId" ORDER BY il."locationTimestamp" ASC, il."createdAt" ASC) AS rn
      FROM "IncidentLocation" il
    ),
    incident_points AS (
      SELECT
        i.id AS incident_id,
        i.title AS category,
        i.status,
        i."createdAt",
        fp.latitude,
        fp.longitude,
        fp.address,
        fp.point_time
      FROM "Incident" i
      LEFT JOIN first_points fp
        ON fp."incidentId" = i.id
       AND fp.rn = 1
      WHERE ${Prisma.join(conditions, " AND ")}
    ),
    filtered_points AS (
      SELECT *
      FROM incident_points fp
      WHERE ${Prisma.join(windowConditions, " AND ")}
    )
  `;
};

const getCategories = async () => {
  const rows = await prisma.incident.groupBy({
    by: ["title"],
    _count: { title: true },
    orderBy: { _count: { title: "desc" } },
    take: 40,
  });
  return rows.map((row) => row.title).filter(Boolean);
};

const getSafetyAnalytics = async ({ role, query }) => {
  if (role !== "ADMIN") {
    throw new AppError(403, "Only ADMIN can view safety analytics.");
  }

  const filters = parseFilters(query);
  const cteWindowed = buildIncidentPointCte(filters, true);
  const cteBase = buildIncidentPointCte(filters, false);
  const cellSize = filters.cellSize;

  const [categories, totals, topCategoryRows, hotspotRows, trendRows, categoryRows, timeRows, topAreaRows, heatRows, markerRows, boundsRows, sliderRows] =
    await Promise.all([
      getCategories(),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            (SELECT COUNT(DISTINCT incident_id)::int FROM filtered_points) AS "matchingIncidents",
            (SELECT COUNT(*)::int FROM (
              SELECT
                FLOOR(latitude / ${cellSize}) * ${cellSize} AS lat_cell,
                FLOOR(longitude / ${cellSize}) * ${cellSize} AS lng_cell
              FROM filtered_points
              GROUP BY lat_cell, lng_cell
            ) areas) AS "distinctAreas",
            (SELECT COUNT(*)::int
             FROM incident_points ip
             WHERE NOT (
               ip.latitude IS NOT NULL
               AND ip.longitude IS NOT NULL
               AND ip.latitude BETWEEN -90 AND 90
               AND ip.longitude BETWEEN -180 AND 180
             )
            ) AS "withoutUsableCoordinates"
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT category, COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY category
          ORDER BY count DESC, category ASC
          LIMIT 1
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          , area_counts AS (
            SELECT
              FLOOR(latitude / ${cellSize}) * ${cellSize} AS lat_cell,
              FLOOR(longitude / ${cellSize}) * ${cellSize} AS lng_cell,
              category,
              COUNT(*)::int AS category_count
            FROM filtered_points
            GROUP BY lat_cell, lng_cell, category
          ),
          area_rank AS (
            SELECT
              lat_cell,
              lng_cell,
              SUM(category_count)::int AS total_count
            FROM area_counts
            GROUP BY lat_cell, lng_cell
          ),
          dominant AS (
            SELECT
              ac.lat_cell,
              ac.lng_cell,
              ac.category,
              ac.category_count,
              ROW_NUMBER() OVER (PARTITION BY ac.lat_cell, ac.lng_cell ORDER BY ac.category_count DESC, ac.category ASC) AS rn
            FROM area_counts ac
          ),
          labels AS (
            SELECT
              FLOOR(latitude / ${cellSize}) * ${cellSize} AS lat_cell,
              FLOOR(longitude / ${cellSize}) * ${cellSize} AS lng_cell,
              MIN(NULLIF(SPLIT_PART(address, ',', 1), '')) AS area_label
            FROM filtered_points
            GROUP BY lat_cell, lng_cell
          )
          SELECT
            ar.lat_cell AS latitude,
            ar.lng_cell AS longitude,
            ar.total_count AS "incidentCount",
            COALESCE(lbl.area_label, CONCAT('Area ', ROUND(ar.lat_cell::numeric, 3), ',', ROUND(ar.lng_cell::numeric, 3))) AS "areaLabel",
            dom.category AS "topCategory"
          FROM area_rank ar
          LEFT JOIN dominant dom ON dom.lat_cell = ar.lat_cell AND dom.lng_cell = ar.lng_cell AND dom.rn = 1
          LEFT JOIN labels lbl ON lbl.lat_cell = ar.lat_cell AND lbl.lng_cell = ar.lng_cell
          ORDER BY ar.total_count DESC, "areaLabel" ASC
          LIMIT ${MAX_HOTSPOTS}
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            DATE_TRUNC(${filters.granularity}, point_time) AS bucket,
            COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT category, COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY category
          ORDER BY count DESC, category ASC
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            CASE
              WHEN EXTRACT(HOUR FROM point_time) < 6 THEN 'Night (00:00-05:59)'
              WHEN EXTRACT(HOUR FROM point_time) < 12 THEN 'Morning (06:00-11:59)'
              WHEN EXTRACT(HOUR FROM point_time) < 18 THEN 'Afternoon (12:00-17:59)'
              ELSE 'Evening (18:00-23:59)'
            END AS bucket,
            COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY bucket
          ORDER BY count DESC
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            COALESCE(NULLIF(SPLIT_PART(address, ',', 1), ''), CONCAT('Area ', ROUND(latitude::numeric, 3), ',', ROUND(longitude::numeric, 3))) AS area,
            COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY area
          ORDER BY count DESC, area ASC
          LIMIT 8
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            AVG(latitude)::float8 AS latitude,
            AVG(longitude)::float8 AS longitude,
            COUNT(*)::int AS intensity,
            FLOOR(latitude / ${cellSize}) * ${cellSize} AS lat_cell,
            FLOOR(longitude / ${cellSize}) * ${cellSize} AS lng_cell
          FROM filtered_points
          GROUP BY lat_cell, lng_cell
          ORDER BY intensity DESC
          LIMIT 500
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            incident_id AS "incidentId",
            latitude,
            longitude,
            status,
            category,
            point_time AS "timestamp",
            COALESCE(NULLIF(SPLIT_PART(address, ',', 1), ''), 'Approximate area') AS "areaLabel"
          FROM filtered_points
          ORDER BY point_time DESC
          LIMIT ${MAX_MARKERS}
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteWindowed}
          SELECT
            MIN(latitude)::float8 AS "minLat",
            MAX(latitude)::float8 AS "maxLat",
            MIN(longitude)::float8 AS "minLng",
            MAX(longitude)::float8 AS "maxLng"
          FROM filtered_points
        `,
      ),
      prisma.$queryRaw(
        Prisma.sql`
          ${cteBase}
          SELECT
            DATE_TRUNC(${filters.granularity}, point_time) AS bucket,
            COUNT(*)::int AS count
          FROM filtered_points
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
      ),
    ]);

  const periodLabel = `${filters.startDate.toISOString().slice(0, 10)} to ${filters.endDate.toISOString().slice(0, 10)} (UTC)`;
  const topCategory = topCategoryRows[0] || null;
  const totalsRow = totals[0] || {
    matchingIncidents: 0,
    distinctAreas: 0,
    withoutUsableCoordinates: 0,
  };

  const sliderBuckets = sliderRows.map((row, index) => {
    const start = new Date(row.bucket);
    let end;
    if (filters.granularity === "hour") {
      end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
    } else if (filters.granularity === "day") {
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else if (filters.granularity === "week") {
      end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    } else {
      const nextMonth = new Date(start);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      end = new Date(nextMonth.getTime() - 1);
    }
    return {
      index,
      label:
        filters.granularity === "hour"
          ? `${start.toISOString().slice(0, 10)} ${pad2(start.getUTCHours())}:00`
          : start.toISOString().slice(0, 10),
      start: start.toISOString(),
      end: end.toISOString(),
      count: row.count,
    };
  });

  return {
    disclaimer: "Historical incident patterns — not a prediction of current danger.",
    timezone: "UTC",
    appliedFilters: {
      startDate: filters.startDate.toISOString(),
      endDate: filters.endDate.toISOString(),
      status: filters.statuses,
      category: filters.category,
      timeOfDay: filters.timeOfDay,
      bounds: filters.bounds,
      cellSize: filters.cellSize,
      granularity: filters.granularity,
      sliderEndAt: filters.sliderEndAt ? filters.sliderEndAt.toISOString() : null,
    },
    options: {
      categories,
      statuses: Array.from(ALLOWED_STATUS),
      timeOfDay: ["ALL", "NIGHT", "MORNING", "AFTERNOON", "EVENING"],
      granularity: ["hour", "day", "week", "month"],
    },
    summary: {
      matchingIncidents: totalsRow.matchingIncidents,
      distinctAreas: totalsRow.distinctAreas,
      withoutUsableCoordinates: totalsRow.withoutUsableCoordinates,
      topCategory: topCategory ? { category: topCategory.category, count: topCategory.count } : null,
      periodLabel,
    },
    hotspots: hotspotRows.map((item, index) => ({
      rank: index + 1,
      latitude: item.latitude,
      longitude: item.longitude,
      areaLabel: item.areaLabel,
      incidentCount: item.incidentCount,
      topCategory: item.topCategory || "Unknown",
      periodLabel,
    })),
    charts: {
      trend: trendRows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        count: row.count,
      })),
      categoryDistribution: categoryRows.map((row) => ({ category: row.category, count: row.count })),
      timeOfDay: timeRows.map((row) => ({ bucket: row.bucket, count: row.count })),
      topAreas: topAreaRows.map((row) => ({ area: row.area, count: row.count })),
    },
    slider: {
      granularity: filters.granularity,
      buckets: sliderBuckets,
    },
    map: {
      heatPoints: heatRows.map((row) => ({
        latitude: row.latitude,
        longitude: row.longitude,
        intensity: row.intensity,
        cellKey: `${row.lat_cell},${row.lng_cell}`,
      })),
      markers: markerRows.map((row) => ({
        incidentId: row.incidentId,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        category: row.category,
        timestamp: new Date(row.timestamp).toISOString(),
        areaLabel: row.areaLabel,
      })),
      bounds:
        boundsRows[0] && boundsRows[0].minLat !== null
          ? {
              minLat: boundsRows[0].minLat,
              maxLat: boundsRows[0].maxLat,
              minLng: boundsRows[0].minLng,
              maxLng: boundsRows[0].maxLng,
            }
          : null,
    },
  };
};

const exportSafetyAnalyticsCsv = async ({ role, query }) => {
  if (role !== "ADMIN") {
    throw new AppError(403, "Only ADMIN can export safety analytics reports.");
  }

  const filters = parseFilters(query);
  const cteWindowed = buildIncidentPointCte(filters, true);
  const cellSize = filters.cellSize;

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      ${cteWindowed}
      SELECT
        DATE_TRUNC(${filters.granularity}, point_time) AS bucket,
        FLOOR(latitude / ${cellSize}) * ${cellSize} AS lat_cell,
        FLOOR(longitude / ${cellSize}) * ${cellSize} AS lng_cell,
        COALESCE(NULLIF(SPLIT_PART(address, ',', 1), ''), CONCAT('Area ', ROUND((FLOOR(latitude / ${cellSize}) * ${cellSize})::numeric, 3), ',', ROUND((FLOOR(longitude / ${cellSize}) * ${cellSize})::numeric, 3))) AS area,
        category,
        COUNT(*)::int AS count
      FROM filtered_points
      GROUP BY bucket, lat_cell, lng_cell, area, category
      ORDER BY bucket ASC, count DESC
      LIMIT 20000
    `,
  );

  const headerRows = [
    ["Report", "Safety Heatmap Historical Analytics"],
    ["Timezone", "UTC"],
    ["Disclaimer", "Historical incident patterns — not a prediction of current danger."],
    ["Start Date", filters.startDate.toISOString()],
    ["End Date", filters.endDate.toISOString()],
    ["Status Filter", filters.statuses.join("|")],
    ["Category Filter", filters.category || "ALL"],
    ["Time Of Day Filter", filters.timeOfDay],
    ["Granularity", filters.granularity],
    [],
    ["time_bucket", "area_label", "latitude_cell", "longitude_cell", "incident_category", "incident_count"],
  ];

  const dataRows = rows.map((row) => [
    new Date(row.bucket).toISOString(),
    row.area,
    row.lat_cell,
    row.lng_cell,
    row.category,
    row.count,
  ]);

  return toCsv([...headerRows, ...dataRows]);
};

module.exports = {
  getSafetyAnalytics,
  exportSafetyAnalyticsCsv,
  __test: {
    parseFilters,
    resolveGranularity,
    parseStatuses,
    parseTimeOfDay,
    parseBounds,
    csvEscape,
  },
};
