import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Download, LayoutGrid, Layers, Columns, ArrowUp, ArrowDown,
  Sparkles, Search, Crown, Activity, RefreshCw
} from 'lucide-react';
import { AnalyticsService } from '@/services/analytics.service';
import { useAnalyticsQuery } from '@/hooks/useAnalyticsQuery';
import { OFFENCES, CENTERS } from '@/data/staticMappings';

const OFFENCE_NAMES = Object.fromEntries(OFFENCES.map(o => [String(o.code), o.name]));
const CENTER_NAMES  = Object.fromEntries(CENTERS.map(c => [String(c.code), c.name]));

// Toggleable display: short = "112", long = "112 — Wrong Parking"
function formatLabel(value, dimension) {
  if (value === 'Other' || value == null) return value;
  const v = String(value).replace(/^\d+-/, '');
  if (dimension === 'offence_code' && OFFENCE_NAMES[v]) return `${v} — ${OFFENCE_NAMES[v]}`;
  if (dimension === 'center_code' && CENTER_NAMES[v]) return `${v} — ${CENTER_NAMES[v]}`;
  return v;
}

const DIMENSIONS = [
  { value: 'vehicle_type',   label: 'Vehicle Type',   group: 'Categorical' },
  { value: 'offence_code',   label: 'Offence Code',   group: 'Categorical' },
  { value: 'police_station', label: 'Police Station', group: 'Categorical' },
  { value: 'center_code',    label: 'Center Code',    group: 'Categorical' },
  { value: 'hour_of_day',    label: 'Hour of Day',    group: 'Temporal' },
  { value: 'day_of_week',    label: 'Day of Week',    group: 'Temporal' },
  { value: 'time_bucket',    label: 'Time Bucket',    group: 'Temporal' },
];

const AGG_MODES = [
  { value: 'count',     label: 'Count',     hint: 'Raw violation count per cell' },
  { value: 'row_pct',   label: '% of Row',  hint: 'Each row sums to 100% — profiles per row' },
  { value: 'col_pct',   label: '% of Col',  hint: 'Each column sums to 100% — profiles per column' },
  { value: 'total_pct', label: '% of Total', hint: 'Each cell as share of the grand total' },
];

const PRESETS = [
  { id: 'veh_hour',     label: 'Vehicle × Hour',    x: 'hour_of_day',    y: 'vehicle_type' },
  { id: 'station_day',  label: 'Station × Day',     x: 'day_of_week',    y: 'police_station' },
  { id: 'offence_veh',  label: 'Offence × Vehicle', x: 'vehicle_type',   y: 'offence_code' },
  { id: 'station_buck', label: 'Station × Bucket',  x: 'time_bucket',    y: 'police_station' },
  { id: 'offence_day',  label: 'Offence × Day',     x: 'day_of_week',    y: 'offence_code' },
];

// Strip the numeric sort prefix from labels like "1-Morning" or "0-Sun".
const clean = (s) => (typeof s === 'string' ? s.replace(/^\d+-/, '') : s);

// Viridis-ish 6-stop ramp interpolated per cell.
const RAMP = [
  [255, 247, 251],
  [212, 226, 240],
  [158, 188, 218],
  [123, 142, 196],
  [109,  64, 167],
  [ 79,   0, 122]
];
function lerpColor(t) {
  if (t <= 0) return RAMP[0];
  if (t >= 1) return RAMP[RAMP.length - 1];
  const seg = t * (RAMP.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}
const fmt = (n, mode) => {
  if (n === 0 || n === undefined || n === null) return '—';
  if (mode === 'count') return n.toLocaleString();
  return `${n.toFixed(1)}%`;
};

function dimLabel(value) {
  return DIMENSIONS.find(d => d.value === value)?.label || value;
}

export default function ExploratorySandbox() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [xDimension, setXDimension] = useState(() => searchParams.get('x') || 'hour_of_day');
  const [yDimension, setYDimension] = useState(() => searchParams.get('y') || 'vehicle_type');
  const [aggregation, setAggregation] = useState(() => searchParams.get('agg') || 'count');
  const [topN, setTopN] = useState(() => Number(searchParams.get('top')) || 15);
  const [sortKey, setSortKey] = useState('__total__'); // '__row__' | column key | '__total__'
  const [sortDir, setSortDir] = useState('desc');
  const [rowFilter, setRowFilter] = useState('');

  // Sync state to URL
  useEffect(() => {
    const next = new URLSearchParams();
    if (xDimension !== 'hour_of_day') next.set('x', xDimension);
    if (yDimension !== 'vehicle_type') next.set('y', yDimension);
    if (aggregation !== 'count') next.set('agg', aggregation);
    if (topN !== 15) next.set('top', String(topN));
    setSearchParams(next, { replace: true });
  }, [xDimension, yDimension, aggregation, topN, setSearchParams]);

  const { data, isLoading } = useAnalyticsQuery(
    () => xDimension === yDimension
      ? Promise.resolve(null)
      : AnalyticsService.getExploratoryData(xDimension, yDimension, { topN }),
    [xDimension, yDimension, topN],
    { useGlobalLoader: true }
  );

  // Transform raw counts → display values based on aggregation mode
  const view = useMemo(() => {
    if (!data) return null;
    const { columns, rowKeys, pivot, rowTotals, colTotals, grandTotal, distinctRows, distinctCols } = data;
    const display = {};
    for (const r of rowKeys) {
      display[r] = {};
      for (const c of columns) {
        const v = pivot[r][c] || 0;
        if (aggregation === 'count') display[r][c] = v;
        else if (aggregation === 'row_pct') display[r][c] = rowTotals[r] ? (v / rowTotals[r]) * 100 : 0;
        else if (aggregation === 'col_pct') display[r][c] = colTotals[c] ? (v / colTotals[c]) * 100 : 0;
        else if (aggregation === 'total_pct') display[r][c] = grandTotal ? (v / grandTotal) * 100 : 0;
      }
    }

    // Compute colour-scale max from non-"Other" cells only. The Other bucket
    // aggregates a long tail and almost always dwarfs individual rows/cols,
    // which would crush the rest of the heatmap into one flat colour.
    let maxCellValue = 0;
    for (const r of rowKeys) {
      if (r === 'Other') continue;
      for (const c of columns) {
        if (c === 'Other') continue;
        if (display[r][c] > maxCellValue) maxCellValue = display[r][c];
      }
    }

    return { columns, rowKeys, display, rowTotals, colTotals, grandTotal, maxCellValue, distinctRows, distinctCols };
  }, [data, aggregation]);

  // Sorting — always pin "Other" to the bottom so it doesn't dominate the eye
  const sortedRowKeys = useMemo(() => {
    if (!view) return [];
    const realKeys = view.rowKeys.filter(k => k !== 'Other');
    const dir = sortDir === 'asc' ? 1 : -1;
    realKeys.sort((a, b) => {
      if (sortKey === '__row__') return clean(a).localeCompare(clean(b)) * dir;
      if (sortKey === '__total__') return (view.rowTotals[a] - view.rowTotals[b]) * dir;
      return ((view.display[a]?.[sortKey] || 0) - (view.display[b]?.[sortKey] || 0)) * dir;
    });
    const all = view.rowKeys.includes('Other') ? [...realKeys, 'Other'] : realKeys;
    return rowFilter
      ? all.filter(k => clean(k).toLowerCase().includes(rowFilter.toLowerCase()))
      : all;
  }, [view, sortKey, sortDir, rowFilter]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }, [sortKey]);

  // Insights — exclude the "Other" rolled-up bucket so we always surface a
  // real, defendable row/cell and never "Other × Wed".
  const insights = useMemo(() => {
    if (!view) return null;
    const realRows = view.rowKeys.filter(r => r !== 'Other');
    const realCols = view.columns.filter(c => c !== 'Other');
    if (realRows.length === 0 || realCols.length === 0) return null;

    let strongest = { value: -1, r: null, c: null };
    let mostDiverseRow = { r: null, spread: -1 };
    for (const r of realRows) {
      let nonZero = 0;
      for (const c of realCols) {
        const v = view.display[r][c];
        if (v > strongest.value) strongest = { value: v, r, c };
        if (v > 0) nonZero += 1;
      }
      if (nonZero > mostDiverseRow.spread) mostDiverseRow = { r, spread: nonZero };
    }
    const topRow = realRows.reduce((acc, r) => view.rowTotals[r] > (view.rowTotals[acc] || 0) ? r : acc, realRows[0]);
    return { strongest, mostDiverseRow, topRow, realColCount: realCols.length };
  }, [view]);

  const applyPreset = useCallback((p) => {
    setXDimension(p.x);
    setYDimension(p.y);
    setSortKey('__total__');
    setSortDir('desc');
  }, []);

  const handleSwapAxes = useCallback(() => {
    setXDimension(yDimension);
    setYDimension(xDimension);
    setSortKey('__total__');
  }, [xDimension, yDimension]);

  function handleExport() {
    if (!view) return;
    const header = [dimLabel(yDimension), ...view.columns.map(c => formatLabel(c, xDimension)), 'Total'];
    const lines = sortedRowKeys.map(r => {
      const cells = view.columns.map(c => view.display[r][c]);
      return [formatLabel(r, yDimension), ...cells.map(v => aggregation === 'count' ? v : v.toFixed(2)), view.rowTotals[r]].map(escapeCSV).join(',');
    });
    const csv = [header.map(escapeCSV).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pivot_${yDimension}_x_${xDimension}_${aggregation}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sameDim = xDimension === yDimension;

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto px-6 md:px-8 space-y-5 animate-in fade-in duration-500 min-h-screen pb-10 min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col space-y-2 border-b pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Exploratory Sandbox</h1>
          <Badge variant="secondary" className="ml-2">Ask any question</Badge>
        </div>
        <p className="text-muted-foreground">
          Cross-tabulate any two dimensions to surface patterns the dashboards don't pre-bake — from <span className="font-medium text-foreground">vehicle × hour</span> to <span className="font-medium text-foreground">station × day</span>.
        </p>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Quick questions:</span>
        {PRESETS.map(p => {
          const active = p.x === xDimension && p.y === yDimension;
          return (
            <Button
              key={p.id}
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

      {/* Query builder */}
      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/30 border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutGrid className="w-4 h-4 text-primary" />
            Query Builder
          </CardTitle>
          <CardDescription className="text-xs">Pick rows, columns, and how to aggregate.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-5">
          <div className="md:col-span-3 space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Rows (Y)</label>
            <DimensionSelect value={yDimension} onChange={setYDimension} disabledValue={xDimension} />
          </div>
          <div className="md:col-span-3 space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Columns className="w-3.5 h-3.5" /> Columns (X)</label>
            <DimensionSelect value={xDimension} onChange={setXDimension} disabledValue={yDimension} />
          </div>
          <div className="md:col-span-3 space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Aggregation</label>
            <Select value={aggregation} onValueChange={setAggregation}>
              <SelectTrigger className="bg-background h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGG_MODES.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    <div className="flex flex-col">
                      <span className="text-sm">{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">{m.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3 flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 h-9" onClick={handleSwapAxes} title="Swap rows ↔ columns">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Swap
              </Button>
              <Button size="sm" className="flex-1 h-9" onClick={handleExport} disabled={!view}>
                <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {sameDim && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          Rows and columns must be different dimensions. Pick another.
        </div>
      )}

      {/* Smart Insights bar */}
      {view && insights && !sameDim && (
        <Card className="shadow-sm border-primary/30 bg-gradient-to-br from-primary/8 to-primary/3">
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Insight
              icon={<Crown className="w-4 h-4 text-primary" />}
              label="Strongest cell"
              value={`${formatLabel(insights.strongest.r, yDimension)} × ${formatLabel(insights.strongest.c, xDimension)}`}
              sub={`${fmt(insights.strongest.value, aggregation)}${aggregation === 'count' && view.grandTotal ? ` · ${((insights.strongest.value / view.grandTotal) * 100).toFixed(1)}% of total` : ''}`}
            />
            <Insight
              icon={<Sparkles className="w-4 h-4 text-primary" />}
              label="Most diversified row"
              value={formatLabel(insights.mostDiverseRow.r, yDimension)}
              sub={`Spans ${insights.mostDiverseRow.spread} of ${insights.realColCount} ${dimLabel(xDimension).toLowerCase()} values`}
            />
            <Insight
              icon={<Activity className="w-4 h-4 text-primary" />}
              label="Top row overall"
              value={formatLabel(insights.topRow, yDimension)}
              sub={`${view.rowTotals[insights.topRow].toLocaleString()} violations${view.grandTotal ? ` · ${((view.rowTotals[insights.topRow] / view.grandTotal) * 100).toFixed(1)}% of total` : ''}`}
            />
          </CardContent>
        </Card>
      )}

      {/* Pivot heatmap */}
      {view && !sameDim && (
        <Card className="shadow-md w-full max-w-full overflow-hidden">
          <CardHeader className="py-3 border-b bg-muted/30">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">
                  {dimLabel(yDimension)} × {dimLabel(xDimension)}
                </CardTitle>
                <CardDescription className="text-xs">
                  {view.rowKeys.filter(k => k !== 'Other').length} of {view.distinctRows.toLocaleString()} {dimLabel(yDimension).toLowerCase()}{view.distinctRows === 1 ? '' : 's'} × {view.columns.filter(k => k !== 'Other').length} of {view.distinctCols.toLocaleString()} {dimLabel(xDimension).toLowerCase()}{view.distinctCols === 1 ? '' : 's'} — colour intensity reflects value{view.rowKeys.includes('Other') || view.columns.includes('Other') ? '. Long-tail values are grouped into "Other".' : '.'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Filter rows…"
                    value={rowFilter}
                    onChange={(e) => setRowFilter(e.target.value)}
                    className="h-8 pl-7 w-44 text-xs"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[640px] max-w-full">
              <table className="border-separate min-w-full" style={{ borderSpacing: 0 }}>
                <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr>
                    <SortableTh
                      className="text-left bg-muted/60 border-r border-b sticky left-0 z-20 min-w-[180px]"
                      label={dimLabel(yDimension)}
                      active={sortKey === '__row__'}
                      dir={sortDir}
                      onClick={() => handleSort('__row__')}
                    />
                    {view.columns.map(col => (
                      <SortableTh
                        key={col}
                        className="bg-muted/60 border-b text-right whitespace-nowrap px-3"
                        label={formatLabel(col, xDimension)}
                        active={sortKey === col}
                        dir={sortDir}
                        onClick={() => handleSort(col)}
                      />
                    ))}
                    <SortableTh
                      className="bg-primary/10 text-primary border-b border-l text-right whitespace-nowrap px-3"
                      label="Total"
                      active={sortKey === '__total__'}
                      dir={sortDir}
                      onClick={() => handleSort('__total__')}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRowKeys.length === 0 ? (
                    <tr><td colSpan={view.columns.length + 2} className="text-center py-12 text-muted-foreground">No rows match the filter.</td></tr>
                  ) : sortedRowKeys.map(r => {
                    const rowTotal = view.rowTotals[r];
                    const rowTotalShare = view.grandTotal ? rowTotal / view.grandTotal : 0;
                    const isOtherRow = r === 'Other';
                    return (
                      <tr key={r} className={`hover:bg-muted/30 transition-colors ${isOtherRow ? 'border-t-2 border-t-border/60' : ''}`}>
                        <td className={`font-medium border-r border-b sticky left-0 px-3 py-2 text-sm whitespace-nowrap z-10 ${isOtherRow ? 'bg-muted/40 text-muted-foreground italic' : 'bg-background'}`}>
                          {formatLabel(r, yDimension)}
                          {isOtherRow && <Badge variant="outline" className="ml-2 text-[10px]">grouped</Badge>}
                        </td>
                        {view.columns.map(c => {
                          const v = view.display[r][c];
                          const isOtherCol = c === 'Other';
                          const isOther = isOtherRow || isOtherCol;
                          const t = view.maxCellValue > 0 ? v / view.maxCellValue : 0;
                          const [rr, gg, bb] = lerpColor(t);
                          const isStrong = insights?.strongest?.r === r && insights?.strongest?.c === c;
                          return (
                            <td
                              key={c}
                              className={`text-right font-mono text-xs px-3 py-2 border-b relative ${isOther ? 'text-muted-foreground italic' : ''}`}
                              style={{
                                background: isOther ? 'hsl(var(--muted) / 0.4)' : `rgb(${rr} ${gg} ${bb} / ${0.18 + 0.82 * t})`,
                                color: !isOther && t > 0.55 ? '#fff' : undefined,
                                outline: isStrong ? '2px solid hsl(var(--primary))' : undefined,
                                outlineOffset: -2
                              }}
                              title={`${formatLabel(r, yDimension)} × ${formatLabel(c, xDimension)} — ${fmt(v, aggregation)}`}
                            >
                              {fmt(v, aggregation)}
                            </td>
                          );
                        })}
                        <td className="text-right font-mono font-bold text-xs px-3 py-2 border-b border-l bg-primary/5 text-primary whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 rounded bg-primary/15 w-12 overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${Math.round(rowTotalShare * 100)}%` }} />
                            </div>
                            <span className="tabular-nums">{rowTotal.toLocaleString()}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Column totals footer */}
                <tfoot className="sticky bottom-0 bg-background">
                  <tr>
                    <td className="font-semibold border-r border-t bg-muted/60 sticky left-0 px-3 py-2 text-sm">Column total</td>
                    {view.columns.map(c => (
                      <td key={c} className="text-right font-mono font-semibold text-xs px-3 py-2 border-t bg-muted/30">
                        {view.colTotals[c].toLocaleString()}
                      </td>
                    ))}
                    <td className="text-right font-mono font-bold text-xs px-3 py-2 border-t border-l bg-primary/10 text-primary">
                      {view.grandTotal.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && !view && (
        <Card className="shadow-md"><CardContent className="p-12 text-center text-sm text-muted-foreground">Running query…</CardContent></Card>
      )}
    </div>
  );
}

function escapeCSV(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function DimensionSelect({ value, onChange, disabledValue }) {
  const groups = [...new Set(DIMENSIONS.map(d => d.group))];
  const currentLabel = DIMENSIONS.find(d => d.value === value)?.label || value;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="bg-background h-9">
        <SelectValue>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map(g => (
          <SelectGroup key={g}>
            <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{g}</SelectLabel>
            {DIMENSIONS.filter(d => d.group === g).map(d => (
              <SelectItem key={d.value} value={d.value} disabled={d.value === disabledValue}>{d.label}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortableTh({ label, active, dir, onClick, className = '' }) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 text-xs font-semibold cursor-pointer select-none hover:text-primary ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function Insight({ icon, label, value, sub }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold mt-1 truncate" title={value}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
