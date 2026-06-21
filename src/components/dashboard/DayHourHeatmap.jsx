import React, { useMemo, useState } from 'react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * 7x24 day-of-week × hour heatmap. Doubles as a filter:
 *  - Click a cell → set dow + single hour
 *  - Click a column header (hour) → set dow=all, single hour
 *  - Click a row header (day) → set dow=that day, hour range full
 *  - Drag across cells → brush a contiguous hour range on one day (or All)
 */
export default function DayHourHeatmap({ data, hourRange, dayOfWeek, onSelect }) {
  const [drag, setDrag] = useState(null); // { dow, startHour, endHour }

  const { grid, max, anomalyThreshold } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    const values = [];
    (data || []).forEach(({ dow, hour, count }) => {
      if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
        g[dow][hour] = count;
        if (count > m) m = count;
        values.push(count);
      }
    });
    // anomaly = > mean + 1.5σ (only flag cells with non-trivial volume)
    let threshold = Infinity;
    if (values.length) {
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      threshold = mean + 1.5 * Math.sqrt(variance);
    }
    return { grid: g, max: m, anomalyThreshold: threshold };
  }, [data]);

  const colorFor = (v) => {
    if (max === 0 || v === 0) return 'rgb(241 245 249)'; // slate-100
    const t = Math.pow(v / max, 0.6);
    // interpolate slate-100 → violet-700
    const r = Math.round(241 + (109 - 241) * t);
    const g = Math.round(245 + (40 - 245) * t);
    const b = Math.round(249 + (217 - 249) * t);
    return `rgb(${r} ${g} ${b})`;
  };

  const isActive = (dow, hour) => {
    const dowMatch = dayOfWeek === 'all' || Number(dayOfWeek) === dow;
    const hourMatch = hour >= hourRange[0] && hour <= hourRange[1];
    return dowMatch && hourMatch;
  };

  const commitDrag = () => {
    if (!drag) return;
    const lo = Math.min(drag.startHour, drag.endHour);
    const hi = Math.max(drag.startHour, drag.endHour);
    onSelect({ dayOfWeek: String(drag.dow), hourRange: [lo, hi] });
    setDrag(null);
  };

  return (
    <div className="w-full select-none" onMouseLeave={() => drag && commitDrag()} onMouseUp={commitDrag}>
      <div className="w-full">
        <table className="w-full border-separate" style={{ borderSpacing: 2, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {HOURS.map(h => <col key={h} />)}
          </colgroup>
          <thead>
            <tr>
              <th></th>
              {HOURS.map(h => (
                <th
                  key={h}
                  className="text-[10px] text-muted-foreground font-medium cursor-pointer hover:text-primary"
                  onClick={() => onSelect({ dayOfWeek: 'all', hourRange: [h, h] })}
                  title={`Filter to hour ${h}:00`}
                >
                  {h % 3 === 0 ? h : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day, dow) => (
              <tr key={day}>
                <td
                  className="text-[11px] text-right pr-2 text-muted-foreground font-medium cursor-pointer hover:text-primary"
                  onClick={() => onSelect({ dayOfWeek: String(dow), hourRange: [0, 23] })}
                  title={`Filter to ${day}`}
                >
                  {day}
                </td>
                {HOURS.map(h => {
                  const v = grid[dow][h];
                  const active = isActive(dow, h);
                  const inDrag = drag && drag.dow === dow && h >= Math.min(drag.startHour, drag.endHour) && h <= Math.max(drag.startHour, drag.endHour);
                  const isAnomaly = v >= anomalyThreshold && v > 0;
                  return (
                    <td
                      key={h}
                      className="cursor-pointer transition-all relative"
                      style={{
                        height: 26,
                        background: colorFor(v),
                        outline: inDrag ? '2px solid hsl(var(--primary))' : (active ? '1.5px solid hsl(var(--primary))' : 'none'),
                        outlineOffset: -1,
                        borderRadius: 3,
                        opacity: active || !drag ? 1 : 0.7,
                        position: 'relative'
                      }}
                      title={`${day} ${String(h).padStart(2,'0')}:00 — ${v.toLocaleString()} violations${isAnomaly ? ' (ANOMALY: above 1.5σ)' : ''}`}
                      onMouseDown={() => setDrag({ dow, startHour: h, endHour: h })}
                      onMouseEnter={() => drag && drag.dow === dow && setDrag({ ...drag, endHour: h })}
                      onClick={() => !drag?.endHour && onSelect({ dayOfWeek: String(dow), hourRange: [h, h] })}
                    >
                      {isAnomaly && (
                        <span
                          aria-hidden
                          style={{
                            position: 'absolute',
                            top: 2, right: 2,
                            width: 4, height: 4,
                            borderRadius: '50%',
                            background: '#facc15',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)'
                          }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="text-[11px] text-muted-foreground">
          Click a cell, drag across hours, or use a row/column header to filter the map.
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 ring-1 ring-black/40" />
          <span>Anomaly (&gt;1.5σ above mean)</span>
        </div>
      </div>
    </div>
  );
}
