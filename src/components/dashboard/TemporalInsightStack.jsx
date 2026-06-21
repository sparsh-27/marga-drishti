import React, { useMemo } from 'react';
import { ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { Sparkles, Car } from 'lucide-react';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PIE_COLORS = ['#6d28d9', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe'];

function bucketLabel(hourRange) {
  const [a, b] = hourRange;
  if (a === 0 && b === 23) return 'all day';
  if (a >= 5 && b <= 11) return 'morning peak';
  if (a >= 12 && b <= 14) return 'lunch hours';
  if (a >= 17 && b <= 21) return 'evening peak';
  if (a >= 22 || b <= 4) return 'late-night';
  return `${String(a).padStart(2,'0')}:00–${String(b).padStart(2,'0')}:00`;
}

export default function TemporalInsightStack({ insights, kpis, hourRange, dayOfWeek }) {
  const aiText = useMemo(() => {
    if (!kpis) return 'Loading enforcement insight…';
    const dayLabel = dayOfWeek === 'all' ? 'all days' : DAY_NAMES[Number(dayOfWeek)];
    const window = bucketLabel(hourRange);
    const deltaTxt = kpis.deltaPct >= 10
      ? `${kpis.deltaPct.toFixed(0)}% above the city-wide hourly average`
      : kpis.deltaPct <= -10
        ? `${Math.abs(kpis.deltaPct).toFixed(0)}% below the city-wide hourly average`
        : 'in line with the city-wide hourly average';
    const stationTxt = kpis.topStation
      ? ` ${kpis.topStation} jurisdiction shows the highest concentration (${kpis.topStationCount.toLocaleString()} violations in this window).`
      : '';
    return `During ${window} on ${dayLabel}, recorded violations are ${deltaTxt}.${stationTxt}`;
  }, [kpis, hourRange, dayOfWeek]);

  const totalVehicles = useMemo(
    () => (insights?.vehicleMix || []).reduce((s, x) => s + x.value, 0),
    [insights]
  );

  return (
    <div className="flex flex-col gap-3">
      {/* AI Insight */}
      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold text-primary">Enforcement Insight</h4>
        </div>
        <p className="text-xs leading-relaxed text-foreground/90">{aiText}</p>
      </div>

      {/* Vehicle Mix */}
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-2">
          <Car className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Vehicle Mix</h4>
        </div>
        <div className="h-[140px] flex items-center">
          {insights?.vehicleMix?.length ? (
            <>
              <div className="w-1/2 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={insights.vehicleMix} dataKey="value" innerRadius={28} outerRadius={55} paddingAngle={2}>
                      {insights.vehicleMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => v.toLocaleString()} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-1/2 text-[11px] space-y-1">
                {insights.vehicleMix.map((v, i) => (
                  <li key={v.name} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="truncate flex-1">{v.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {totalVehicles ? Math.round((v.value / totalVehicles) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="w-full text-center text-xs text-muted-foreground">No data in window</div>
          )}
        </div>
      </div>
    </div>
  );
}
