import { DatabaseService } from './database.service';

export const AnalyticsService = {
    async getExecutiveSummary({ days } = {}) {
        const conn = await DatabaseService.getConn();
        try {
            // Optional date filter — narrows everything to the last N days of the dataset.
            // Defendable: we anchor "today" to the max date in the dataset, not wall-clock.
            const wherePeriod = days
                ? `WHERE cast(created_datetime as date) > (SELECT max(cast(created_datetime as date)) - INTERVAL ${days} DAY FROM traffic_violations)`
                : '';
            const wherePeriodAnd = days
                ? `AND cast(created_datetime as date) > (SELECT max(cast(created_datetime as date)) - INTERVAL ${days} DAY FROM traffic_violations)`
                : '';

            const [headlineRes, dailyRes, offencesRes, stationsRes, vehiclesRes] = await Promise.all([
                conn.query(`
                    SELECT
                        (SELECT count(*) FROM traffic_violations ${wherePeriod}) as total,
                        (SELECT count(DISTINCT police_station) FROM traffic_violations WHERE police_station IS NOT NULL ${wherePeriodAnd}) as stations,
                        (SELECT count(DISTINCT vehicle_type) FROM traffic_violations WHERE vehicle_type IS NOT NULL ${wherePeriodAnd}) as vehicle_types,
                        (SELECT count(DISTINCT code) FROM traffic_violations, UNNEST(offence_code) AS t(code) ${wherePeriod}) as distinct_offences,
                        (SELECT min(cast(created_datetime as date)) FROM traffic_violations ${wherePeriod}) as date_start,
                        (SELECT max(cast(created_datetime as date)) FROM traffic_violations ${wherePeriod}) as date_end,
                        (SELECT date_part('hour', cast(created_datetime as timestamp)) as h
                            FROM traffic_violations ${wherePeriod} GROUP BY h ORDER BY count(*) DESC LIMIT 1) as peak_hour,
                        (SELECT dayofweek(cast(created_datetime as timestamp)) as d
                            FROM traffic_violations ${wherePeriod} GROUP BY d ORDER BY count(*) DESC LIMIT 1) as peak_dow,
                        (SELECT police_station FROM traffic_violations WHERE police_station IS NOT NULL ${wherePeriodAnd}
                            GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as top_station,
                        (SELECT count(*) FROM traffic_violations WHERE police_station IS NOT NULL ${wherePeriodAnd}
                            GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as top_station_count,
                        (SELECT code FROM traffic_violations, UNNEST(offence_code) AS t(code) ${wherePeriod}
                            GROUP BY code ORDER BY count(*) DESC LIMIT 1) as top_offence,
                        (SELECT count(*) FROM traffic_violations, UNNEST(offence_code) AS t(code) ${wherePeriod}
                            GROUP BY code ORDER BY count(*) DESC LIMIT 1) as top_offence_count
                `),
                conn.query(`
                    SELECT cast(created_datetime as date) as date, count(*) as count
                    FROM traffic_violations
                    ${wherePeriod}
                    GROUP BY date
                    ORDER BY date ASC
                `),
                conn.query(`
                    SELECT code, count(*) as count
                    FROM traffic_violations, UNNEST(offence_code) AS t(code)
                    ${wherePeriod}
                    GROUP BY code
                    ORDER BY count DESC
                    LIMIT 5
                `),
                conn.query(`
                    SELECT police_station as station, count(*) as count
                    FROM traffic_violations
                    WHERE police_station IS NOT NULL ${wherePeriodAnd}
                    GROUP BY police_station
                    ORDER BY count DESC
                    LIMIT 5
                `),
                conn.query(`
                    SELECT vehicle_type, count(*) as count
                    FROM traffic_violations
                    WHERE vehicle_type IS NOT NULL ${wherePeriodAnd}
                    GROUP BY vehicle_type
                    ORDER BY count DESC
                `)
            ]);

            const h = headlineRes.toArray()[0].toJSON();
            const total = Number(h.total);

            const daily = dailyRes.toArray().map(r => {
                const j = r.toJSON();
                return { date: new Date(Number(j.date)), count: Number(j.count) };
            });

            // Split the timeline in half → compute prior-period vs current-period delta.
            // Defendable: it's just a mid-split on the dataset's own dates.
            let deltaPct = null;
            let priorTotal = 0, currentTotal = 0;
            let midDate = null;
            if (daily.length >= 4) {
                const mid = Math.floor(daily.length / 2);
                midDate = daily[mid].date;
                priorTotal = daily.slice(0, mid).reduce((s, d) => s + d.count, 0);
                currentTotal = daily.slice(mid).reduce((s, d) => s + d.count, 0);
                if (priorTotal > 0) deltaPct = ((currentTotal - priorTotal) / priorTotal) * 100;
            }

            // Compute "what changed" — fetch the same top-1 offence/station/peak-day
            // for each half and report differences as bullets.
            let changeBullets = [];
            if (midDate) {
                const midStr = midDate.toISOString().slice(0, 10);
                const dateBoundClause = days ? wherePeriodAnd : 'AND 1=1';
                try {
                    const [priorRes, currRes] = await Promise.all([
                        conn.query(`
                            SELECT
                                (SELECT police_station FROM traffic_violations
                                    WHERE police_station IS NOT NULL AND cast(created_datetime as date) < DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as ts,
                                (SELECT code FROM traffic_violations, UNNEST(offence_code) AS t(code)
                                    WHERE cast(created_datetime as date) < DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY code ORDER BY count(*) DESC LIMIT 1) as toff,
                                (SELECT dayofweek(cast(created_datetime as timestamp)) as d FROM traffic_violations
                                    WHERE cast(created_datetime as date) < DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY d ORDER BY count(*) DESC LIMIT 1) as pdow,
                                (SELECT count(*) FROM traffic_violations, UNNEST(offence_code) AS t(code)
                                    WHERE cast(created_datetime as date) < DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY code ORDER BY count(*) DESC LIMIT 1) as toff_count
                        `),
                        conn.query(`
                            SELECT
                                (SELECT police_station FROM traffic_violations
                                    WHERE police_station IS NOT NULL AND cast(created_datetime as date) >= DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as ts,
                                (SELECT code FROM traffic_violations, UNNEST(offence_code) AS t(code)
                                    WHERE cast(created_datetime as date) >= DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY code ORDER BY count(*) DESC LIMIT 1) as toff,
                                (SELECT dayofweek(cast(created_datetime as timestamp)) as d FROM traffic_violations
                                    WHERE cast(created_datetime as date) >= DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY d ORDER BY count(*) DESC LIMIT 1) as pdow,
                                (SELECT count(*) FROM traffic_violations, UNNEST(offence_code) AS t(code)
                                    WHERE cast(created_datetime as date) >= DATE '${midStr}' ${dateBoundClause}
                                    GROUP BY code ORDER BY count(*) DESC LIMIT 1) as toff_count
                        `)
                    ]);
                    const p = priorRes.toArray()[0].toJSON();
                    const c = currRes.toArray()[0].toJSON();
                    const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

                    // Volume delta
                    if (deltaPct !== null && Math.abs(deltaPct) >= 5) {
                        changeBullets.push({
                            kind: 'volume',
                            text: `Total volume ${deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(deltaPct).toFixed(1)}% vs first half of period`,
                            direction: deltaPct >= 0 ? 'up' : 'down'
                        });
                    }
                    // Top station shift
                    if (p.ts && c.ts && p.ts !== c.ts) {
                        changeBullets.push({
                            kind: 'station',
                            text: `${c.ts} overtook ${p.ts} as #1 station`,
                            direction: 'change'
                        });
                    }
                    // Top offence shift
                    if (p.toff !== null && c.toff !== null && Number(p.toff) !== Number(c.toff)) {
                        changeBullets.push({
                            kind: 'offence',
                            text: `Top offence shifted from code ${p.toff} to ${c.toff}`,
                            direction: 'change'
                        });
                    } else if (p.toff_count && c.toff_count) {
                        const offDelta = ((Number(c.toff_count) - Number(p.toff_count)) / Number(p.toff_count)) * 100;
                        if (Math.abs(offDelta) >= 10) {
                            changeBullets.push({
                                kind: 'offence',
                                text: `Top offence (code ${c.toff}) ${offDelta >= 0 ? 'up' : 'down'} ${Math.abs(offDelta).toFixed(0)}% vs first half`,
                                direction: offDelta >= 0 ? 'up' : 'down'
                            });
                        }
                    }
                    // Peak day shift
                    if (p.pdow !== null && c.pdow !== null && Number(p.pdow) !== Number(c.pdow)) {
                        changeBullets.push({
                            kind: 'day',
                            text: `Peak day shifted from ${DAY[Number(p.pdow)]} to ${DAY[Number(c.pdow)]}`,
                            direction: 'change'
                        });
                    }
                } catch (e) { /* non-fatal; bullets just won't render */ }
            }

            const sparkline = daily.map(d => ({ date: d.date.toLocaleDateString(), count: d.count }));

            const topOffences = offencesRes.toArray().map(r => {
                const j = r.toJSON();
                return { code: Number(j.code), count: Number(j.count), share: total ? (Number(j.count) / total) * 100 : 0 };
            });
            const topStations = stationsRes.toArray().map(r => {
                const j = r.toJSON();
                return { station: String(j.station), count: Number(j.count), share: total ? (Number(j.count) / total) * 100 : 0 };
            });
            const vehicles = vehiclesRes.toArray().map(r => {
                const j = r.toJSON();
                return { name: String(j.vehicle_type), count: Number(j.count), share: total ? (Number(j.count) / total) * 100 : 0 };
            });

            const dateStart = h.date_start ? new Date(Number(h.date_start)) : null;
            const dateEnd = h.date_end ? new Date(Number(h.date_end)) : null;

            return {
                total,
                stationsCount: Number(h.stations),
                vehicleTypesCount: Number(h.vehicle_types),
                distinctOffences: Number(h.distinct_offences),
                dateStart, dateEnd,
                peakHour: h.peak_hour !== null ? Number(h.peak_hour) : null,
                peakDow:  h.peak_dow  !== null ? Number(h.peak_dow)  : null,
                topStation: h.top_station,
                topStationCount: Number(h.top_station_count),
                topOffenceCode: h.top_offence !== null ? Number(h.top_offence) : null,
                topOffenceCount: Number(h.top_offence_count),
                deltaPct, priorTotal, currentTotal,
                changeBullets,
                sparkline,
                topOffences,
                topStations,
                vehicles
            };
        } catch (e) { console.error(e); return null; }
    },

    async getExecutiveKPIs() {
        const conn = await DatabaseService.getConn();
        try {
            const res = await conn.query(`
                SELECT 
                    (SELECT count(*) FROM traffic_violations) as total_violations,
                    (SELECT code FROM traffic_violations, UNNEST(offence_code) AS t(code) GROUP BY code ORDER BY count(*) DESC LIMIT 1) as top_category,
                    (SELECT police_station FROM traffic_violations GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as top_station,
                    (SELECT date_part('hour', cast(created_datetime as timestamp)) as h FROM traffic_violations GROUP BY h ORDER BY count(*) DESC LIMIT 1) as peak_hour
            `);
            const row = res.toArray()[0].toJSON();
            return {
                totalViolations: Number(row.total_violations),
                topCategory: row.top_category,
                topStation: row.top_station,
                peakHour: Number(row.peak_hour)
            };
        } catch (e) {
            console.error(e);
            return null;
        }
    },

    async getTrendData() {
        const conn = await DatabaseService.getConn();
        try {
            const res = await conn.query(`
                SELECT date_trunc('day', cast(created_datetime as timestamp)) as date, count(*) as count
                FROM traffic_violations
                GROUP BY date
                ORDER BY date ASC
            `);
            return res.toArray().map(r => {
                const j = r.toJSON();
                return { date: new Date(Number(j.date)).toLocaleDateString(), count: Number(j.count) };
            });
        } catch (e) { console.error(e); return []; }
    },

    async getCategoryBreakdown() {
        const conn = await DatabaseService.getConn();
        try {
            const res = await conn.query(`
                SELECT code as name, count(*) as value
                FROM traffic_violations, UNNEST(offence_code) AS t(code)
                GROUP BY name
                ORDER BY value DESC
                LIMIT 5
            `);
            return res.toArray().map(r => ({ name: String(r.toJSON().name), value: Number(r.toJSON().value) }));
        } catch (e) { console.error(e); return []; }
    },

    async getVehicleClassification() {
        const conn = await DatabaseService.getConn();
        try {
            const res = await conn.query(`
                SELECT vehicle_type as name, count(*) as value
                FROM traffic_violations
                GROUP BY vehicle_type
                ORDER BY value DESC
            `);
            return res.toArray().map(r => ({ name: String(r.toJSON().name), value: Number(r.toJSON().value) }));
        } catch (e) { console.error(e); return []; }
    },

    async getTemporalHotspots(hourRange, dayOfWeek) {
        const conn = await DatabaseService.getConn();
        try {
            let where = '';
            let clauses = [];
            if (hourRange) {
                clauses.push(`date_part('hour', cast(created_datetime as timestamp)) BETWEEN ${hourRange[0]} AND ${hourRange[1]}`);
            }
            if (dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== 'all') {
                clauses.push(`dayofweek(cast(created_datetime as timestamp)) = ${dayOfWeek}`);
            }
            if (clauses.length > 0) where = 'WHERE ' + clauses.join(' AND ');
            
            const sql = `SELECT longitude, latitude, police_station, date_part('hour', cast(created_datetime as timestamp)) as hour FROM traffic_violations ${where}`;
            const arrowTable = await conn.query(sql);
            return arrowTable.toArray().map(r => {
                const j = r.toJSON();
                return {
                    longitude: j.longitude,
                    latitude: j.latitude,
                    hour: Number(j.hour),
                    policeStation: j.police_station ? String(j.police_station) : null
                };
            });
        } catch (e) { console.error(e); return null; }
    },

    async getTemporalKPIs(hourRange, dayOfWeek) {
        const conn = await DatabaseService.getConn();
        try {
            const clauses = [];
            if (hourRange) clauses.push(`date_part('hour', cast(created_datetime as timestamp)) BETWEEN ${hourRange[0]} AND ${hourRange[1]}`);
            if (dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== 'all') {
                clauses.push(`dayofweek(cast(created_datetime as timestamp)) = ${dayOfWeek}`);
            }
            const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

            const res = await conn.query(`
                SELECT
                    (SELECT count(*) FROM traffic_violations ${where}) as window_total,
                    (SELECT count(*) FROM traffic_violations) as overall_total,
                    (SELECT date_part('hour', cast(created_datetime as timestamp)) as h
                        FROM traffic_violations ${where}
                        GROUP BY h ORDER BY count(*) DESC LIMIT 1) as peak_hour,
                    (SELECT dayofweek(cast(created_datetime as timestamp)) as d
                        FROM traffic_violations ${where}
                        GROUP BY d ORDER BY count(*) DESC LIMIT 1) as peak_dow,
                    (SELECT police_station FROM traffic_violations ${where ? where + ' AND' : 'WHERE'} police_station IS NOT NULL
                        GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as top_station,
                    (SELECT count(*) FROM traffic_violations ${where ? where + ' AND' : 'WHERE'} police_station IS NOT NULL
                        GROUP BY police_station ORDER BY count(*) DESC LIMIT 1) as top_station_count
            `);
            const row = res.toArray()[0].toJSON();
            const windowTotal = Number(row.window_total);
            const overallTotal = Number(row.overall_total);
            // hours selected in window
            const hours = hourRange ? (hourRange[1] - hourRange[0] + 1) : 24;
            const days = (dayOfWeek !== undefined && dayOfWeek !== 'all') ? 1 : 7;
            const windowFraction = (hours * days) / (24 * 7);
            const expected = overallTotal * windowFraction;
            const deltaPct = expected > 0 ? ((windowTotal - expected) / expected) * 100 : 0;

            return {
                windowTotal,
                overallTotal,
                peakHour: row.peak_hour !== null ? Number(row.peak_hour) : null,
                peakDow: row.peak_dow !== null ? Number(row.peak_dow) : null,
                topStation: row.top_station,
                topStationCount: row.top_station_count !== null ? Number(row.top_station_count) : 0,
                deltaPct
            };
        } catch (e) { console.error(e); return null; }
    },

    async getDayHourHeatmap() {
        const conn = await DatabaseService.getConn();
        try {
            const res = await conn.query(`
                SELECT
                    dayofweek(cast(created_datetime as timestamp)) as dow,
                    date_part('hour', cast(created_datetime as timestamp)) as hour,
                    count(*) as count
                FROM traffic_violations
                GROUP BY dow, hour
            `);
            return res.toArray().map(r => {
                const j = r.toJSON();
                return { dow: Number(j.dow), hour: Number(j.hour), count: Number(j.count) };
            });
        } catch (e) { console.error(e); return []; }
    },

    async getTemporalInsights(hourRange, dayOfWeek) {
        const conn = await DatabaseService.getConn();
        try {
            const clauses = [];
            if (hourRange) clauses.push(`date_part('hour', cast(created_datetime as timestamp)) BETWEEN ${hourRange[0]} AND ${hourRange[1]}`);
            if (dayOfWeek !== undefined && dayOfWeek !== null && dayOfWeek !== 'all') {
                clauses.push(`dayofweek(cast(created_datetime as timestamp)) = ${dayOfWeek}`);
            }
            const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

            const vehicleRes = await conn.query(`
                SELECT vehicle_type as name, count(*) as value
                FROM traffic_violations
                ${where}
                GROUP BY vehicle_type
                ORDER BY value DESC
                LIMIT 6
            `);

            const parse = (res) => res.toArray().map(r => {
                const j = r.toJSON();
                return { name: String(j.name), value: Number(j.value) };
            });

            return {
                vehicleMix: parse(vehicleRes)
            };
        } catch (e) { console.error(e); return null; }
    },

    async getEnforcementRecommendations(limit = 8) {
        const conn = await DatabaseService.getConn();
        try {
            const [rankedRes, totalsRes] = await Promise.all([
                conn.query(`
                    WITH per_slot AS (
                        SELECT
                            police_station,
                            date_part('hour', cast(created_datetime as timestamp)) as hour,
                            dayofweek(cast(created_datetime as timestamp)) as dow,
                            count(*) as cnt,
                            avg(latitude) as lat,
                            avg(longitude) as lng
                        FROM traffic_violations
                        WHERE police_station IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
                        GROUP BY police_station, hour, dow
                    ),
                    ranked AS (
                        SELECT
                            police_station, hour, dow, cnt, lat, lng,
                            row_number() OVER (PARTITION BY police_station ORDER BY cnt DESC) as rn,
                            sum(cnt) OVER (PARTITION BY police_station) as total,
                            avg(lat) OVER (PARTITION BY police_station) as station_lat,
                            avg(lng) OVER (PARTITION BY police_station) as station_lng
                        FROM per_slot
                    )
                    SELECT police_station, hour as peak_hour, dow as peak_dow, cnt as peak_count, total,
                           station_lat as lat, station_lng as lng
                    FROM ranked
                    WHERE rn = 1
                    ORDER BY total DESC
                    LIMIT ${limit}
                `),
                conn.query(`
                    SELECT
                        (SELECT count(*) FROM traffic_violations WHERE police_station IS NOT NULL) as total_with_station,
                        (SELECT count(*) FROM traffic_violations) as overall_total,
                        (SELECT count(DISTINCT police_station) FROM traffic_violations WHERE police_station IS NOT NULL) as distinct_stations
                `)
            ]);

            const rows = rankedRes.toArray().map(r => {
                const j = r.toJSON();
                const peakHour = Number(j.peak_hour);
                const total = Number(j.total);
                return {
                    station: String(j.police_station),
                    peakHour,
                    peakDow: Number(j.peak_dow),
                    peakCount: Number(j.peak_count),
                    total,
                    lat: Number(j.lat),
                    lng: Number(j.lng),
                    windowStart: Math.max(0, peakHour - 1),
                    windowEnd: Math.min(23, peakHour + 2)
                };
            });

            const totalsJ = totalsRes.toArray()[0].toJSON();
            const overallTotal = Number(totalsJ.overall_total);
            const distinctStations = Number(totalsJ.distinct_stations);
            const coveredViolations = rows.reduce((s, r) => s + r.total, 0);
            const coverage = distinctStations > 1 ? {
                violationsCovered: coveredViolations,
                overallTotal,
                violationPct: overallTotal ? (coveredViolations / overallTotal) * 100 : 0,
                stationsTargeted: rows.length,
                distinctStations,
                stationPct: distinctStations ? (rows.length / distinctStations) * 100 : 0
            } : null;

            return { rows, coverage };
        } catch (e) { console.error(e); return { rows: [], coverage: null }; }
    },

    async getChronicHotspots(limit = 6) {
        const conn = await DatabaseService.getConn();
        try {
            // Only meaningful if there is variation across police stations.
            const distinctRes = await conn.query(`SELECT count(DISTINCT police_station) as n FROM traffic_violations WHERE police_station IS NOT NULL`);
            const distinct = Number(distinctRes.toArray()[0].toJSON().n);
            if (distinct < 3) return [];

            const res = await conn.query(`
                WITH bucketed AS (
                    SELECT
                        police_station,
                        CASE
                            WHEN date_part('hour', cast(created_datetime as timestamp)) BETWEEN 5 AND 11 THEN 'morning'
                            WHEN date_part('hour', cast(created_datetime as timestamp)) BETWEEN 12 AND 16 THEN 'afternoon'
                            WHEN date_part('hour', cast(created_datetime as timestamp)) BETWEEN 17 AND 21 THEN 'evening'
                            ELSE 'night'
                        END as bucket,
                        count(*) as cnt
                    FROM traffic_violations
                    WHERE police_station IS NOT NULL
                    GROUP BY police_station, bucket
                ),
                ranked_in_bucket AS (
                    SELECT police_station, bucket, cnt,
                        row_number() OVER (PARTITION BY bucket ORDER BY cnt DESC) as rn
                    FROM bucketed
                ),
                top_per_bucket AS (
                    SELECT police_station, bucket FROM ranked_in_bucket WHERE rn <= 5
                ),
                chronic AS (
                    SELECT police_station,
                        count(DISTINCT bucket) as bucket_count,
                        string_agg(DISTINCT bucket, ', ') as buckets
                    FROM top_per_bucket
                    GROUP BY police_station
                    HAVING count(DISTINCT bucket) >= 3
                )
                SELECT c.police_station, c.bucket_count, c.buckets,
                    (SELECT count(*) FROM traffic_violations tv WHERE tv.police_station = c.police_station) as total,
                    (SELECT avg(latitude) FROM traffic_violations tv WHERE tv.police_station = c.police_station) as lat,
                    (SELECT avg(longitude) FROM traffic_violations tv WHERE tv.police_station = c.police_station) as lng
                FROM chronic c
                ORDER BY c.bucket_count DESC, total DESC
                LIMIT ${limit}
            `);
            return res.toArray().map(r => {
                const j = r.toJSON();
                return {
                    station: String(j.police_station),
                    bucketCount: Number(j.bucket_count),
                    buckets: String(j.buckets || '').split(', ').filter(Boolean),
                    total: Number(j.total),
                    lat: j.lat !== null ? Number(j.lat) : null,
                    lng: j.lng !== null ? Number(j.lng) : null,
                };
            });
        } catch (e) { console.error(e); return []; }
    },

    async getRegionalData(centerCode, policeStation, junction) {
        const conn = await DatabaseService.getConn();
        try {
            let whereClauses = [];
            if (centerCode && centerCode !== 'all') whereClauses.push(`center_code = ${centerCode}`);
            if (policeStation && policeStation !== 'all') whereClauses.push(`police_station = '${policeStation}'`);
            if (junction && junction !== 'all') whereClauses.push(`junction = '${junction}'`);
            const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

            const stationsRes = await conn.query(`
                SELECT 
                    police_station, 
                    count(*) as violations,
                    (SELECT vehicle_type FROM traffic_violations tv2 WHERE tv2.police_station = tv1.police_station GROUP BY vehicle_type ORDER BY count(*) DESC LIMIT 1) as primary_vehicle,
                    (SELECT code FROM traffic_violations tv3, UNNEST(tv3.offence_code) AS t(code) WHERE tv3.police_station = tv1.police_station GROUP BY code ORDER BY count(*) DESC LIMIT 1) as primary_violation
                FROM traffic_violations tv1
                ${where}
                GROUP BY police_station
                ORDER BY violations DESC
                LIMIT 20
            `);

            const junctionsRes = await conn.query(`
                SELECT junction as name, count(*) as value
                FROM traffic_violations
                ${where}
                GROUP BY junction
                ORDER BY value DESC
                LIMIT 10
            `);

            const radarRes = await conn.query(`
                SELECT code as subject, count(*) as A
                FROM traffic_violations, UNNEST(offence_code) AS t(code)
                ${where}
                GROUP BY subject
                ORDER BY A DESC
                LIMIT 6
            `);

            const parseRows = (res) => res.toArray().map(r => {
                const obj = {};
                for (const [k,v] of Object.entries(r.toJSON())) {
                    obj[k] = typeof v === 'bigint' ? Number(v) : v;
                }
                return obj;
            });

            return {
                stations: parseRows(stationsRes),
                junctions: parseRows(junctionsRes),
                radar: parseRows(radarRes)
            };
        } catch(e) { console.error(e); return null; }
    },

    async getExploratoryData(xDimension, yDimension, { topN = 15 } = {}) {
        const conn = await DatabaseService.getConn();
        try {
            // Map a logical dimension to a SQL expression + a label-formatter.
            const DIM_SQL = {
                vehicle_type: { expr: 'vehicle_type', isList: false },
                offence_code: { expr: 'code', isList: true },
                police_station: { expr: 'police_station', isList: false },
                center_code: { expr: 'cast(center_code as varchar)', isList: false },
                hour_of_day: { expr: `lpad(cast(date_part('hour', cast(created_datetime as timestamp)) as varchar), 2, '0') || ':00'`, isList: false },
                day_of_week: {
                    expr: `case dayofweek(cast(created_datetime as timestamp))
                             when 0 then '0-Sun' when 1 then '1-Mon' when 2 then '2-Tue'
                             when 3 then '3-Wed' when 4 then '4-Thu' when 5 then '5-Fri'
                             when 6 then '6-Sat' end`,
                    isList: false
                },
                time_bucket: {
                    expr: `case
                             when date_part('hour', cast(created_datetime as timestamp)) between 5 and 11 then '1-Morning'
                             when date_part('hour', cast(created_datetime as timestamp)) between 12 and 16 then '2-Afternoon'
                             when date_part('hour', cast(created_datetime as timestamp)) between 17 and 21 then '3-Evening'
                             else '4-Night' end`,
                    isList: false
                }
            };

            const x = DIM_SQL[xDimension];
            const y = DIM_SQL[yDimension];
            if (!x || !y) return null;

            const needsUnnest = x.isList || y.isList;
            const fromClause = needsUnnest
                ? 'FROM traffic_violations, UNNEST(offence_code) AS t(code)'
                : 'FROM traffic_violations';

            const xExpr = x.expr;
            const yExpr = y.expr;

            const res = await conn.query(`
                SELECT ${xExpr} as x, ${yExpr} as y, count(*) as c
                ${fromClause}
                WHERE ${xExpr} IS NOT NULL AND ${yExpr} IS NOT NULL
                GROUP BY x, y
            `);

            const raw = res.toArray().map(r => {
                const j = r.toJSON();
                return { x: String(j.x), y: String(j.y), c: Number(j.c) };
            });

            // Aggregate row/column totals to enable top-N + percentage modes.
            const rowTotalsMap = new Map();
            const colTotalsMap = new Map();
            let grandTotal = 0;
            for (const { x, y, c } of raw) {
                rowTotalsMap.set(y, (rowTotalsMap.get(y) || 0) + c);
                colTotalsMap.set(x, (colTotalsMap.get(x) || 0) + c);
                grandTotal += c;
            }

            // Temporal dimensions have small known cardinality (24/7/4) AND
            // a natural order (chronological). Skip top-N + sort lexically by
            // their numeric prefix so we don't lose hours or shuffle them.
            const isTemporal = (dim) => dim === 'hour_of_day' || dim === 'day_of_week' || dim === 'time_bucket';

            let finalRowKeys, droppedRowKeys = [];
            if (isTemporal(yDimension)) {
                finalRowKeys = Array.from(rowTotalsMap.keys()).sort();
            } else {
                const allRowKeys = Array.from(rowTotalsMap.entries()).sort((a, b) => b[1] - a[1]);
                const kept = allRowKeys.slice(0, topN).map(([k]) => k);
                droppedRowKeys = allRowKeys.slice(topN).map(([k]) => k);
                finalRowKeys = droppedRowKeys.length ? [...kept, 'Other'] : kept;
            }

            let finalColKeys, droppedColKeys = [];
            if (isTemporal(xDimension)) {
                finalColKeys = Array.from(colTotalsMap.keys()).sort();
            } else {
                const allColKeys = Array.from(colTotalsMap.entries()).sort((a, b) => b[1] - a[1]);
                const kept = allColKeys.slice(0, topN).map(([k]) => k);
                droppedColKeys = allColKeys.slice(topN).map(([k]) => k);
                finalColKeys = droppedColKeys.length ? [...kept, 'Other'] : kept;
            }

            const keptRowKeys = new Set(finalRowKeys.filter(k => k !== 'Other'));
            const keptColKeys = new Set(finalColKeys.filter(k => k !== 'Other'));

            // Build pivot { [row]: { [col]: count } }
            const pivot = {};
            for (const r of finalRowKeys) pivot[r] = Object.fromEntries(finalColKeys.map(c => [c, 0]));

            for (const { x, y, c } of raw) {
                const rowKey = keptRowKeys.has(y) ? y : 'Other';
                const colKey = keptColKeys.has(x) ? x : 'Other';
                if (pivot[rowKey]) pivot[rowKey][colKey] = (pivot[rowKey][colKey] || 0) + c;
            }

            // Recompute totals from the final (grouped) pivot so they match what is displayed.
            const rowTotals = {};
            const colTotals = Object.fromEntries(finalColKeys.map(c => [c, 0]));
            for (const r of finalRowKeys) {
                let t = 0;
                for (const c of finalColKeys) {
                    t += pivot[r][c] || 0;
                    colTotals[c] += pivot[r][c] || 0;
                }
                rowTotals[r] = t;
            }

            return {
                xDimension,
                yDimension,
                columns: finalColKeys,
                rowKeys: finalRowKeys,
                pivot,
                rowTotals,
                colTotals,
                grandTotal,
                distinctRows: rowTotalsMap.size,
                distinctCols: colTotalsMap.size,
                topN
            };
        } catch (e) { console.error(e); return null; }
    },

    async getGeospatialMapData({ centerCode, offenceCode, vehicleType }) {
        const conn = await DatabaseService.getConn();
        try {
            let whereClauses = [];
            
            if (offenceCode && offenceCode !== 'all') {
                whereClauses.push(`list_contains(offence_code, ${offenceCode})`);
            }
            
            if (vehicleType && vehicleType !== 'all') {
                whereClauses.push(`vehicle_type = '${vehicleType}'`);
            }

            const isCityWide = !centerCode || centerCode === 'all';
            
            if (isCityWide) {
                const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
                const res = await conn.query(`
                    SELECT 
                        center_code, 
                        avg(latitude) as lat, 
                        avg(longitude) as lng, 
                        count(*) as total 
                    FROM traffic_violations 
                    ${where} 
                    GROUP BY center_code
                `);
                return {
                    type: 'city-wide',
                    data: res.toArray().map(r => ({
                        center_code: Number(r.toJSON().center_code),
                        latitude: Number(r.toJSON().lat),
                        longitude: Number(r.toJSON().lng),
                        total: Number(r.toJSON().total)
                    }))
                };
            } else {
                whereClauses.push(`center_code = ${centerCode}`);
                const where = 'WHERE ' + whereClauses.join(' AND ');
                const res = await conn.query(`
                    SELECT latitude as lat, longitude as lng 
                    FROM traffic_violations 
                    ${where}
                `);
                return {
                    type: 'center-zoomed',
                    data: res.toArray().map(r => ({
                        latitude: Number(r.toJSON().lat),
                        longitude: Number(r.toJSON().lng)
                    }))
                };
            }
        } catch(e) { console.error(e); return null; }
    }
};
