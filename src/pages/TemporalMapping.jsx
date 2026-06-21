import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MapContainer from '@/components/dashboard/MapContainer';
import DayHourHeatmap from '@/components/dashboard/DayHourHeatmap';
import TemporalInsightStack from '@/components/dashboard/TemporalInsightStack';
import EnforcementRecommendations from '@/components/dashboard/EnforcementRecommendations';
import ChronicHotspots from '@/components/dashboard/ChronicHotspots';
import { AnalyticsService } from '@/services/analytics.service';
import { useAnalyticsQuery } from '@/hooks/useAnalyticsQuery';
import {
  Activity, AlertTriangle, Clock, MapPin, TrendingUp, TrendingDown, Layers,
  Play, Pause, RotateCcw, Columns2
} from 'lucide-react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PRESETS = [
  { label: 'Morning Peak', hourRange: [8, 11], dayOfWeek: 'all' },
  { label: 'Lunch', hourRange: [12, 14], dayOfWeek: 'all' },
  { label: 'Evening Peak', hourRange: [17, 21], dayOfWeek: 'all' },
  { label: 'Late Night', hourRange: [22, 23], dayOfWeek: 'all' },
  { label: 'All Day', hourRange: [0, 23], dayOfWeek: 'all' },
];

const LAYER_MODES = [
  { id: 'hex', label: 'Hexbins' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'points', label: 'Points' },
  { id: 'impact', label: 'Impact' },
];

const COMPARE_PRESETS = [
  { id: 'morning-evening', label: 'AM vs PM Peak', a: { hourRange: [8, 11], dayOfWeek: 'all' }, b: { hourRange: [17, 21], dayOfWeek: 'all' } },
  { id: 'weekday-weekend', label: 'Weekday vs Weekend', a: { hourRange: [0, 23], dayOfWeek: '2' }, b: { hourRange: [0, 23], dayOfWeek: '6' } },
  { id: 'day-night', label: 'Day vs Night', a: { hourRange: [9, 17], dayOfWeek: 'all' }, b: { hourRange: [22, 23], dayOfWeek: 'all' } },
];

const PLAYBACK_WINDOW = 3; // hours wide
const PLAYBACK_STEP_MS = 700;

// ---- URL helpers ----
function parseUrlState(sp) {
  const h = sp.get('h');
  let hourRange = [0, 23];
  if (h && /^\d{1,2}-\d{1,2}$/.test(h)) {
    const [a, b] = h.split('-').map(Number);
    if (a >= 0 && a <= 23 && b >= 0 && b <= 23) hourRange = [Math.min(a, b), Math.max(a, b)];
  }
  const d = sp.get('d');
  const dayOfWeek = (d && /^[0-6]$/.test(d)) ? d : 'all';
  const l = sp.get('l');
  const layerMode = ['hex', 'heatmap', 'points'].includes(l) ? l : 'hex';
  return { hourRange, dayOfWeek, layerMode };
}

function KpiTile({ icon: Icon, label, value, sub, tone = 'default' }) {
  const toneClass = {
    default: 'border-border',
    danger: 'border-destructive/40',
    success: 'border-emerald-500/40',
  }[tone];
  return (
    <Card className={`shadow-sm ${toneClass}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="text-2xl font-bold tabular-nums truncate" title={String(value ?? '—')}>{value ?? '—'}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function TemporalMapping() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = useMemo(() => parseUrlState(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [hourRange, setHourRange] = useState(initial.hourRange);
  const [debouncedHourRange, setDebouncedHourRange] = useState(initial.hourRange);
  const [dayOfWeek, setDayOfWeek] = useState(initial.dayOfWeek);
  const [layerMode, setLayerMode] = useState(initial.layerMode);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef(null);

  // Map fly-to target (incremented timestamp to force the effect each click)
  const [flyTo, setFlyTo] = useState(null);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [windowB, setWindowB] = useState({ hourRange: [17, 21], dayOfWeek: 'all' });
  const [debouncedWindowB, setDebouncedWindowB] = useState(windowB);
  useEffect(() => {
    const h = setTimeout(() => setDebouncedWindowB(windowB), 250);
    return () => clearTimeout(h);
  }, [windowB]);

  // Debounce slider
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedHourRange(hourRange), 250);
    return () => clearTimeout(handler);
  }, [hourRange]);

  // Sync state → URL
  useEffect(() => {
    const next = new URLSearchParams();
    if (!(hourRange[0] === 0 && hourRange[1] === 23)) next.set('h', `${hourRange[0]}-${hourRange[1]}`);
    if (dayOfWeek !== 'all') next.set('d', String(dayOfWeek));
    if (layerMode !== 'hex') next.set('l', layerMode);
    setSearchParams(next, { replace: true });
  }, [hourRange, dayOfWeek, layerMode, setSearchParams]);

  // Playback effect
  useEffect(() => {
    if (!isPlaying) return;
    playTimerRef.current = setInterval(() => {
      setHourRange(([start]) => {
        const nextStart = start + 1 > 23 - PLAYBACK_WINDOW ? 0 : start + 1;
        return [nextStart, Math.min(23, nextStart + PLAYBACK_WINDOW)];
      });
    }, PLAYBACK_STEP_MS);
    return () => clearInterval(playTimerRef.current);
  }, [isPlaying]);

  const togglePlay = useCallback(() => {
    setIsPlaying(p => {
      const next = !p;
      if (next) {
        // entering play: seed a tight window
        setHourRange(([s]) => {
          const start = (s > 23 - PLAYBACK_WINDOW) ? 0 : s;
          return [start, Math.min(23, start + PLAYBACK_WINDOW)];
        });
      }
      return next;
    });
  }, []);

  const resetPlayback = useCallback(() => {
    setIsPlaying(false);
    setHourRange([0, 23]);
    setDayOfWeek('all');
  }, []);

  const { data: mapData } = useAnalyticsQuery(
    () => AnalyticsService.getTemporalHotspots(debouncedHourRange, dayOfWeek),
    [debouncedHourRange, dayOfWeek],
    { useGlobalLoader: !isPlaying } // suppress big spinner during animation
  );

  const { data: kpis } = useAnalyticsQuery(
    () => AnalyticsService.getTemporalKPIs(debouncedHourRange, dayOfWeek),
    [debouncedHourRange, dayOfWeek]
  );

  const { data: insights } = useAnalyticsQuery(
    () => AnalyticsService.getTemporalInsights(debouncedHourRange, dayOfWeek),
    [debouncedHourRange, dayOfWeek]
  );

  const { data: heatmapData } = useAnalyticsQuery(
    () => AnalyticsService.getDayHourHeatmap(),
    []
  );

  const { data: recommendations } = useAnalyticsQuery(
    () => AnalyticsService.getEnforcementRecommendations(8),
    []
  );

  const { data: chronicHotspots } = useAnalyticsQuery(
    () => AnalyticsService.getChronicHotspots(6),
    []
  );

  // Second-window queries (only fire when compare mode is on)
  const { data: mapDataB } = useAnalyticsQuery(
    () => compareMode
      ? AnalyticsService.getTemporalHotspots(debouncedWindowB.hourRange, debouncedWindowB.dayOfWeek)
      : Promise.resolve(null),
    [compareMode, debouncedWindowB]
  );
  const { data: kpisB } = useAnalyticsQuery(
    () => compareMode
      ? AnalyticsService.getTemporalKPIs(debouncedWindowB.hourRange, debouncedWindowB.dayOfWeek)
      : Promise.resolve(null),
    [compareMode, debouncedWindowB]
  );

  const handleSliderChange = useCallback((value) => {
    if (isPlaying) setIsPlaying(false);
    setHourRange(value);
  }, [isPlaying]);

  const applyPreset = useCallback((preset) => {
    setIsPlaying(false);
    setHourRange(preset.hourRange);
    setDayOfWeek(preset.dayOfWeek);
  }, []);

  const handleHeatmapSelect = useCallback(({ dayOfWeek: d, hourRange: r }) => {
    setIsPlaying(false);
    setDayOfWeek(d);
    setHourRange(r);
  }, []);

  const handleJumpToWindow = useCallback(({ hourRange: r, dayOfWeek: d }) => {
    setIsPlaying(false);
    setHourRange(r);
    setDayOfWeek(d);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleZoomToJunction = useCallback(({ lat, lng, name }) => {
    if (lat === undefined || lng === undefined || lat === null || lng === null) return;
    setFlyTo({ lat, lng, zoom: 15, name, _ts: Date.now() });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const deltaPct = kpis?.deltaPct ?? 0;
  // The window is "the whole dataset" when no filter is applied — comparing to
  // itself yields 0%, which reads as broken. Only show a number when the user
  // has actually narrowed the window.
  const isFullWindow = hourRange[0] === 0 && hourRange[1] === 23 && dayOfWeek === 'all';
  const deltaTone = isFullWindow ? 'default' : (deltaPct >= 10 ? 'danger' : deltaPct <= -10 ? 'success' : 'default');
  const deltaIcon = deltaPct >= 0 ? TrendingUp : TrendingDown;

  const peakHourLabel = useMemo(() => {
    if (kpis?.peakHour === null || kpis?.peakHour === undefined) return '—';
    return `${String(kpis.peakHour).padStart(2,'0')}:00`;
  }, [kpis]);

  const peakDowLabel = useMemo(() => {
    if (kpis?.peakDow === null || kpis?.peakDow === undefined) return '—';
    return DAY_NAMES[kpis.peakDow];
  }, [kpis]);

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto px-6 md:px-8 space-y-5 animate-in fade-in duration-500 min-h-screen pb-10">
      {/* Header */}
      <div className="flex flex-col space-y-2 border-b pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Temporal Hotspot Analysis</h1>
          <Badge variant="secondary" className="ml-2">Parking × Congestion</Badge>
        </div>
        <p className="text-muted-foreground">
          Identify <span className="font-medium text-foreground">when</span> illegal parking chokes Bengaluru carriageways — so enforcement patrols can be scheduled, not just dispatched.
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          icon={Activity}
          label="Violations in Window"
          value={kpis?.windowTotal?.toLocaleString() ?? '—'}
          sub={kpis ? `of ${kpis.overallTotal.toLocaleString()} total` : null}
        />
        <KpiTile
          icon={deltaIcon}
          label="Δ vs Baseline"
          value={!kpis ? '—' : isFullWindow ? '—' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}
          sub={isFullWindow ? 'Narrow the window to compare' : 'vs city-wide hourly average'}
          tone={deltaTone}
        />
        <KpiTile
          icon={Clock}
          label="Peak Hour / Day"
          value={`${peakHourLabel} · ${peakDowLabel}`}
          sub="busiest slot in current window"
        />
        <KpiTile
          icon={MapPin}
          label="Top Hotspot Station"
          value={kpis?.topStation ?? '—'}
          sub={kpis?.topStationCount ? `${kpis.topStationCount.toLocaleString()} violations in window` : null}
          tone="danger"
        />
      </div>

      {/* Toolbar: presets + playback + layer toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Presets:</span>
          {PRESETS.map(p => {
            const active = p.hourRange[0] === hourRange[0] && p.hourRange[1] === hourRange[1] && p.dayOfWeek === dayOfWeek;
            return (
              <Button
                key={p.label}
                size="sm"
                variant={active ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {/* Playback */}
          <div className="flex items-center gap-1.5 border rounded-md bg-background px-1.5 py-0.5">
            <Button
              size="sm"
              variant={isPlaying ? 'default' : 'ghost'}
              className="h-7 px-2"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play time-of-day animation'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="ml-1 text-[11px] font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={resetPlayback}
              title="Reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Compare toggle */}
          <Button
            size="sm"
            variant={compareMode ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => { setIsPlaying(false); setCompareMode(v => !v); }}
            title="Compare two time windows side by side"
          >
            <Columns2 className="w-3.5 h-3.5 mr-1.5" />
            {compareMode ? 'Exit Compare' : 'Compare'}
          </Button>

          {/* Layer toggle */}
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <div className="inline-flex rounded-md border bg-background overflow-hidden">
              {LAYER_MODES.map(m => (
                <button
                  key={m.id}
                  onClick={() => setLayerMode(m.id)}
                  className={`px-3 py-1 text-xs transition-colors ${layerMode === m.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Compare preset row (only when compareMode is on) */}
      {compareMode && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span className="text-xs text-muted-foreground">Quick compares:</span>
          {COMPARE_PRESETS.map(p => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                setHourRange(p.a.hourRange);
                setDayOfWeek(p.a.dayOfWeek);
                setWindowB(p.b);
              }}
            >
              {p.label}
            </Button>
          ))}
          <div className="ml-auto text-xs text-muted-foreground">
            Maps share viewport — zoom/pan one to move both.
          </div>
        </div>
      )}

      {/* Main map + sidebar */}
      <div className={`flex flex-col lg:flex-row gap-5 ${compareMode ? 'h-[700px] lg:h-[820px]' : 'h-[600px] lg:h-[640px]'}`}>
        {/* Map column */}
        <div className={`flex-1 lg:w-[68%] h-full ${compareMode ? 'flex flex-col gap-3' : ''}`}>
          {/* Window A */}
          <div className={`relative shadow-lg rounded-xl overflow-hidden border border-border ${compareMode ? 'flex-1 min-h-0' : 'h-full'}`}>
            <MapContainer mapData={mapData} layerMode={layerMode} flyTo={flyTo} />
            {kpis && (
              <div className="absolute top-3 left-3 z-30 bg-background/90 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-md max-w-[80%]">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  {compareMode ? 'Window A' : 'Currently viewing'}
                  {isPlaying && !compareMode && (
                    <span className="flex items-center gap-1 text-primary">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      LIVE
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold">
                  {String(hourRange[0]).padStart(2,'0')}:00–{String(hourRange[1]).padStart(2,'0')}:00 · {dayOfWeek === 'all' ? 'All days' : DAY_NAMES[Number(dayOfWeek)]}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">{kpis.windowTotal.toLocaleString()} violations</div>
              </div>
            )}
          </div>

          {/* Window B (compare mode) */}
          {compareMode && (
            <div className="relative shadow-lg rounded-xl overflow-hidden border border-primary/40 flex-1 min-h-0">
              <MapContainer mapData={mapDataB} layerMode={layerMode} />
              <div className="absolute top-3 left-3 z-30 bg-background/90 backdrop-blur border border-primary/40 rounded-lg px-3 py-2 shadow-md max-w-[80%]">
                <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Window B</div>
                <div className="text-sm font-semibold">
                  {String(windowB.hourRange[0]).padStart(2,'0')}:00–{String(windowB.hourRange[1]).padStart(2,'0')}:00 · {windowB.dayOfWeek === 'all' ? 'All days' : DAY_NAMES[Number(windowB.dayOfWeek)]}
                </div>
                {kpisB && (
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {kpisB.windowTotal.toLocaleString()} violations
                    {kpis && kpisB.windowTotal !== kpis.windowTotal && (
                      <span className={`ml-2 font-semibold ${kpisB.windowTotal > kpis.windowTotal ? 'text-destructive' : 'text-emerald-600'}`}>
                        {kpisB.windowTotal > kpis.windowTotal ? '+' : ''}{(((kpisB.windowTotal - kpis.windowTotal) / Math.max(kpis.windowTotal, 1)) * 100).toFixed(0)}% vs A
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="lg:w-[32%] flex flex-col gap-4 overflow-y-auto pr-1">
          <Card className="shadow-md">
            <CardHeader className="bg-muted/30 border-b py-3">
              <CardTitle className="text-base">{compareMode ? 'Window A Controls' : 'Temporal Controls'}</CardTitle>
              <CardDescription className="text-xs">Filter by time window and day.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time Window</label>
                  <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
                    {String(hourRange[0]).padStart(2, '0')}:00 – {String(hourRange[1]).padStart(2, '0')}:00
                  </span>
                </div>
                <div className="pt-2 px-1">
                  <Slider
                    value={hourRange}
                    min={0}
                    max={23}
                    step={1}
                    onValueChange={handleSliderChange}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day of Week</label>
                <Select value={dayOfWeek} onValueChange={(v) => { setIsPlaying(false); setDayOfWeek(v); }}>
                  <SelectTrigger className="w-full h-9">
                    <SelectValue placeholder="All Days" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Days</SelectItem>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {compareMode ? (
            <Card className="shadow-md border-primary/40">
              <CardHeader className="bg-primary/5 border-b py-3">
                <CardTitle className="text-base text-primary">Window B Controls</CardTitle>
                <CardDescription className="text-xs">Second comparison window.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time Window</label>
                    <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
                      {String(windowB.hourRange[0]).padStart(2, '0')}:00 – {String(windowB.hourRange[1]).padStart(2, '0')}:00
                    </span>
                  </div>
                  <div className="pt-2 px-1">
                    <Slider
                      value={windowB.hourRange}
                      min={0}
                      max={23}
                      step={1}
                      onValueChange={(v) => setWindowB(w => ({ ...w, hourRange: v }))}
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day of Week</label>
                  <Select value={windowB.dayOfWeek} onValueChange={(v) => setWindowB(w => ({ ...w, dayOfWeek: v }))}>
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="All Days" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Days</SelectItem>
                      <SelectItem value="0">Sunday</SelectItem>
                      <SelectItem value="1">Monday</SelectItem>
                      <SelectItem value="2">Tuesday</SelectItem>
                      <SelectItem value="3">Wednesday</SelectItem>
                      <SelectItem value="4">Thursday</SelectItem>
                      <SelectItem value="5">Friday</SelectItem>
                      <SelectItem value="6">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {kpis && kpisB && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Comparison</div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Window A</span><span className="font-mono">{kpis.windowTotal.toLocaleString()}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Window B</span><span className="font-mono">{kpisB.windowTotal.toLocaleString()}</span></div>
                    <div className="flex justify-between text-xs pt-1 border-t border-border">
                      <span className="text-muted-foreground">B − A</span>
                      <span className={`font-mono font-bold ${kpisB.windowTotal > kpis.windowTotal ? 'text-destructive' : 'text-emerald-600'}`}>
                        {kpisB.windowTotal >= kpis.windowTotal ? '+' : ''}{(kpisB.windowTotal - kpis.windowTotal).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <TemporalInsightStack
              insights={insights}
              kpis={kpis}
              hourRange={hourRange}
              dayOfWeek={dayOfWeek}
            />
          )}
        </div>
      </div>

      {/* Day-Hour Heatmap */}
      <Card className="shadow-md">
        <CardHeader className="py-3 border-b bg-muted/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-primary" />
                Day × Hour Violation Heatmap
              </CardTitle>
              <CardDescription className="text-xs">
                The whole week at a glance — darker cells indicate higher violation volume. Click or drag to filter the map above.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0 pt-1">
              <span>Low</span>
              <div className="h-2 w-24 rounded" style={{ background: 'linear-gradient(to right, rgb(241,245,249), rgb(109,40,217))' }} />
              <span>High</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <DayHourHeatmap
            data={heatmapData}
            hourRange={hourRange}
            dayOfWeek={dayOfWeek}
            onSelect={handleHeatmapSelect}
          />
        </CardContent>
      </Card>

      {/* Enforcement Recommendations + Chronic Hotspots */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3">
          <EnforcementRecommendations
            data={recommendations}
            onJumpToWindow={handleJumpToWindow}
            onZoomToJunction={handleZoomToJunction}
          />
        </div>
        <div className="lg:col-span-2">
          <ChronicHotspots
            data={chronicHotspots}
            onZoomToJunction={handleZoomToJunction}
          />
        </div>
      </div>

      {flyTo?.name && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
             onAnimationEnd={() => setTimeout(() => setFlyTo(f => f?._ts === flyTo._ts ? null : f), 3000)}>
          Zoomed to <span className="font-bold">{flyTo.name}</span>
        </div>
      )}
    </div>
  );
}
