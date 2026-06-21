import React, { useMemo, useCallback, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, MapPin, Clock, AlertTriangle, TrendingUp, TrendingDown,
  Calendar, FileText, Layers, Building2, Car, ShieldAlert,
  ArrowRight, Download, Sparkles, ArrowLeftRight
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, LineChart, Line, BarChart, Bar
} from 'recharts';
import { AnalyticsService } from '@/services/analytics.service';
import { useAnalyticsQuery } from '@/hooks/useAnalyticsQuery';
import { OFFENCES } from '@/data/staticMappings';
import DayHourHeatmap from '@/components/dashboard/DayHourHeatmap';

const OFFENCE_NAMES = Object.fromEntries(OFFENCES.map(o => [o.code, o.name]));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIMARY = '#6d28d9';

const RANGE_PRESETS = [
  { id: '30',  label: 'Last 30 days', days: 30 },
  { id: '90',  label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time',     days: null },
];

function fmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function Sparkline({ data, color = PRIMARY }) {
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey="count" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function KpiTile({ icon: Icon, label, value, sub, sparkline, delta, tone = 'default', to }) {
  const toneClass = {
    default: 'border-border',
    danger: 'border-destructive/40',
    success: 'border-emerald-500/40',
  }[tone];
  const deltaPositive = delta !== null && delta !== undefined && delta >= 0;
  const inner = (
    <CardContent className="p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="text-2xl font-bold tabular-nums truncate" title={String(value ?? '—')}>{value ?? '—'}</div>
      <div className="flex items-center justify-between mt-1 gap-2">
        <span className="text-[11px] text-muted-foreground truncate">{sub}</span>
        {delta !== null && delta !== undefined && (
          <span className={`text-[11px] font-semibold tabular-nums flex items-center ${deltaPositive ? 'text-destructive' : 'text-emerald-600'}`}>
            {deltaPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
            {deltaPositive ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mx-2 opacity-70">
          <Sparkline data={sparkline} />
        </div>
      )}
      {to && (
        <div className="mt-2 text-[10px] text-primary font-semibold flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          Drill down <ArrowRight className="w-3 h-3" />
        </div>
      )}
    </CardContent>
  );
  if (to) {
    return (
      <Link to={to} className="block group">
        <Card className={`shadow-sm ${toneClass} hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full`}>
          {inner}
        </Card>
      </Link>
    );
  }
  return <Card className={`shadow-sm ${toneClass}`}>{inner}</Card>;
}

function MiniTableRow({ rank, label, count, share, total, onClick }) {
  const pct = total ? (count / total) * 100 : 0;
  const body = (
    <>
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" title={label}>{label}</div>
      </div>
      <div className="w-32 shrink-0">
        <div className="h-1.5 rounded bg-primary/15 overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
      <div className="w-24 text-right tabular-nums shrink-0">
        <div className="text-sm font-bold">{count.toLocaleString()}</div>
        <div className="text-[10px] text-muted-foreground">{share.toFixed(1)}% of total</div>
      </div>
    </>
  );
  const className = "w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-muted/40 transition-colors text-left";
  if (onClick) {
    return <button type="button" onClick={onClick} className={className + " group"}>{body}<ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" /></button>;
  }
  return <div className={className}>{body}</div>;
}

function SkeletonKpi() {
  return (
    <Card><CardContent className="p-4 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-9 w-full mt-2" />
    </CardContent></Card>
  );
}

export default function ExecutiveSummary() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rangeId = searchParams.get('range') || 'all';
  const preset = RANGE_PRESETS.find(p => p.id === rangeId) || RANGE_PRESETS[2];

  const setRange = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'all') next.delete('range'); else next.set('range', id);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data, isLoading } = useAnalyticsQuery(
    () => AnalyticsService.getExecutiveSummary({ days: preset.days }),
    [preset.id]
  );
  const { data: dayHour } = useAnalyticsQuery(AnalyticsService.getDayHourHeatmap, []);

  const headline = useMemo(() => {
    if (!data) return 'Loading executive briefing…';
    const topOffName = OFFENCE_NAMES[data.topOffenceCode] || `code ${data.topOffenceCode}`;
    const topOffPct = data.total ? ((data.topOffenceCount / data.total) * 100).toFixed(1) : '—';
    const topStationPct = data.total ? ((data.topStationCount / data.total) * 100).toFixed(1) : '—';
    const peakHourLabel = data.peakHour !== null ? `${String(data.peakHour).padStart(2,'0')}:00` : '—';
    return `${data.total.toLocaleString()} violations recorded across ${data.stationsCount} police-station jurisdictions between ${fmtDate(data.dateStart)} and ${fmtDate(data.dateEnd)}. ${topOffName} alone accounts for ${topOffPct}% of all tickets, and ${data.topStation} jurisdiction handles ${topStationPct}% of city-wide volume. Peak enforcement hour is ${peakHourLabel}.`;
  }, [data]);

  const sparklineAll = data?.sparkline || [];
  const topOffNameForKpi = data ? (OFFENCE_NAMES[data.topOffenceCode] || `Code ${data.topOffenceCode}`) : '—';

  // Cross-page deep links
  const topOffenceLink = data ? `/analytics/sandbox?x=hour_of_day&y=offence_code` : null;
  const topStationLink = data ? `/analytics/sandbox?x=day_of_week&y=police_station` : null;
  const peakHourLink = data && data.peakHour !== null
    ? `/analytics/temporal?h=${data.peakHour}-${Math.min(23, data.peakHour + 2)}`
    : '/analytics/temporal';

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto px-6 md:px-8 space-y-5 animate-in fade-in duration-500 min-h-screen pb-10 min-w-0 overflow-x-hidden" id="exec-print-root">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Executive Summary</h1>
            <Badge variant="secondary" className="ml-2">Weekly briefing</Badge>
          </div>
          {/* Range filter + download */}
          <div className="flex items-center gap-2 print:hidden">
            <div className="inline-flex rounded-md border bg-background overflow-hidden">
              {RANGE_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setRange(p.id)}
                  className={`px-3 py-1.5 text-xs transition-colors ${preset.id === p.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => window.print()}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Download briefing
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground">
          High-level operational overview of Bengaluru traffic enforcement — built directly from the BTP/ASTraM violation dataset.
        </p>
      </div>

      {/* Headline banner */}
      <Card className="shadow-sm border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm leading-relaxed">{headline}</p>
        </CardContent>
      </Card>

      {/* What changed callout */}
      {data?.changeBullets?.length > 0 && (
        <Card className="shadow-sm border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-amber-700 dark:text-amber-400" />
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">What changed in this period</span>
              <span className="text-[11px] text-muted-foreground">(second half vs first half)</span>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {data.changeBullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  {b.direction === 'up' && <TrendingUp className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />}
                  {b.direction === 'down' && <TrendingDown className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" />}
                  {b.direction === 'change' && <ArrowLeftRight className="w-3.5 h-3.5 mt-0.5 text-amber-700 shrink-0" />}
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      {isLoading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <SkeletonKpi key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            icon={Activity}
            label="Total Violations"
            value={data?.total?.toLocaleString() ?? '—'}
            sub={data ? `${fmtDate(data.dateStart)} → ${fmtDate(data.dateEnd)}` : null}
            sparkline={sparklineAll}
            delta={data?.deltaPct}
            to="/analytics/temporal"
          />
          <KpiTile
            icon={AlertTriangle}
            label="Top Offence"
            value={data ? `${data.topOffenceCode}` : '—'}
            sub={topOffNameForKpi}
            tone="danger"
            to={topOffenceLink}
          />
          <KpiTile
            icon={MapPin}
            label="Top Station"
            value={data?.topStation ?? '—'}
            sub={data ? `${data.topStationCount.toLocaleString()} violations · ${data.total ? ((data.topStationCount / data.total) * 100).toFixed(1) : 0}% of total` : null}
            to={topStationLink}
          />
          <KpiTile
            icon={Clock}
            label="Peak Hour"
            value={data?.peakHour !== null && data?.peakHour !== undefined ? `${String(data.peakHour).padStart(2,'0')}:00` : '—'}
            sub={data?.peakDow !== null && data?.peakDow !== undefined ? `Most active on ${DAY_NAMES[data.peakDow]}` : null}
            to={peakHourLink}
          />
        </div>
      )}

      {/* Coverage strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5 text-primary" /> {data.stationsCount} police stations</div>
          <div className="flex items-center gap-2"><Car className="w-3.5 h-3.5 text-primary" /> {data.vehicleTypesCount} vehicle types</div>
          <div className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5 text-primary" /> {data.distinctOffences} offence categories tracked</div>
          <div className="flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-primary" /> {data.sparkline.length} days of records</div>
        </div>
      )}

      {/* Volume Trend */}
      <Card className="shadow-md">
        <CardHeader className="py-3 border-b bg-muted/30">
          <CardTitle className="text-base">Daily Volume Trend</CardTitle>
          <CardDescription className="text-xs">
            Tickets issued per day{data?.deltaPct !== null && data?.deltaPct !== undefined ? ` — second half ${data.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(data.deltaPct).toFixed(1)}% vs first half of period` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-[280px]">
            {isLoading && !data ? (
              <Skeleton className="w-full h-full" />
            ) : data && data.sparkline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.sparkline} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                  <RechartsTooltip
                    contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [v.toLocaleString(), 'Violations']}
                  />
                  <Area type="monotone" dataKey="count" stroke={PRIMARY} strokeWidth={2} fill="url(#trendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No trend data available.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top 5 Offences + Top 5 Stations side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="shadow-md">
          <CardHeader className="py-3 border-b bg-muted/30">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-primary" />
              Top 5 Offences
            </CardTitle>
            <CardDescription className="text-xs">Most ticketed offence codes. Click a row to see hour distribution.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && !data ? (
              [0,1,2,3,4].map(i => <div key={i} className="px-4 py-3 border-b"><Skeleton className="h-5 w-full" /></div>)
            ) : data?.topOffences?.length ? data.topOffences.map((o, i) => (
              <MiniTableRow
                key={o.code}
                rank={i + 1}
                label={`${o.code} — ${OFFENCE_NAMES[o.code] || 'Unknown'}`}
                count={o.count}
                share={o.share}
                total={data.topOffences[0].count}
                onClick={() => navigate(`/analytics/sandbox?x=hour_of_day&y=offence_code`)}
              />
            )) : (
              <div className="p-6 text-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader className="py-3 border-b bg-muted/30">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Top 5 Police Stations
            </CardTitle>
            <CardDescription className="text-xs">Jurisdictions with the highest volume. Click a row for station × day matrix.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && !data ? (
              [0,1,2,3,4].map(i => <div key={i} className="px-4 py-3 border-b"><Skeleton className="h-5 w-full" /></div>)
            ) : data?.topStations?.length ? data.topStations.map((s, i) => (
              <MiniTableRow
                key={s.station}
                rank={i + 1}
                label={s.station}
                count={s.count}
                share={s.share}
                total={data.topStations[0].count}
                onClick={() => navigate(`/analytics/sandbox?x=day_of_week&y=police_station`)}
              />
            )) : (
              <div className="p-6 text-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicle mix + Day×Hour */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="shadow-md">
          <CardHeader className="py-3 border-b bg-muted/30">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="w-4 h-4 text-primary" />
              Vehicle Mix
            </CardTitle>
            <CardDescription className="text-xs">All vehicle types with their share of total violations.</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[280px]">
              {isLoading && !data ? (
                <Skeleton className="w-full h-full" />
              ) : data?.vehicles?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.vehicles} margin={{ top: 8, right: 16, left: 4, bottom: 32 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                    <RechartsTooltip
                      contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                      formatter={(v, _, item) => [`${v.toLocaleString()} (${item?.payload?.share?.toFixed(1) ?? '—'}%)`, 'Violations']}
                    />
                    <Bar dataKey="count" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader className="py-3 border-b bg-muted/30">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              Day × Hour Activity
            </CardTitle>
            <CardDescription className="text-xs">
              Whole-week activity. See Temporal Analysis for filtering.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[280px] overflow-hidden flex items-center">
              <DayHourHeatmap
                data={dayHour}
                hourRange={[0, 23]}
                dayOfWeek={'all'}
                onSelect={({ hourRange, dayOfWeek }) => {
                  const url = new URL('http://x/analytics/temporal');
                  if (!(hourRange[0] === 0 && hourRange[1] === 23)) url.searchParams.set('h', `${hourRange[0]}-${hourRange[1]}`);
                  if (dayOfWeek !== 'all') url.searchParams.set('d', String(dayOfWeek));
                  navigate(url.pathname + url.search);
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
