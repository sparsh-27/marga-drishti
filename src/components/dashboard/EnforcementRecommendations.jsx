import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Clock, MapPin, Download, Crosshair, Target } from 'lucide-react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function priorityFor(rank) {
  if (rank === 0) return { label: 'CRITICAL', cls: 'bg-destructive text-destructive-foreground' };
  if (rank < 3) return { label: 'HIGH', cls: 'bg-orange-500 text-white' };
  if (rank < 6) return { label: 'MEDIUM', cls: 'bg-amber-400 text-amber-950' };
  return { label: 'WATCH', cls: 'bg-muted text-muted-foreground' };
}

function toCSV(rows) {
  const header = ['rank', 'priority', 'police_station', 'peak_day', 'peak_window', 'peak_window_violations', 'total_violations', 'lat', 'lng'];
  const lines = rows.map((r, i) => [
    i + 1,
    priorityFor(i).label,
    `"${r.station.replace(/"/g, '""')}"`,
    DAY_NAMES[r.peakDow],
    `${String(r.windowStart).padStart(2,'0')}:00-${String(r.windowEnd).padStart(2,'0')}:00`,
    r.peakCount,
    r.total,
    r.lat?.toFixed(6) ?? '',
    r.lng?.toFixed(6) ?? ''
  ].join(','));
  return [header.join(','), ...lines].join('\n');
}

function download(filename, content, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EnforcementRecommendations({ data, onJumpToWindow, onZoomToJunction }) {
  const rows = data?.rows || [];
  const coverage = data?.coverage;

  const handleExport = () => {
    download(`enforcement-recommendations-${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows));
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="py-3 border-b bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              Top Hotspot Stations
            </CardTitle>
            <CardDescription className="text-xs">
              Police-station jurisdictions ranked by total recorded violations, with each station's peak day and hour. Click a row to filter the map; click the crosshair to zoom to that station's centroid.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExport} disabled={!rows.length}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>

      {/* Coverage estimator — only shown when there is real variation across stations */}
      {coverage && rows.length > 0 && coverage.distinctStations > rows.length && (
        <div className="px-4 py-3 border-b bg-gradient-to-r from-primary/8 to-primary/3 flex items-start gap-3">
          <Target className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm leading-relaxed">
            These top{' '}
            <span className="font-bold text-primary">{coverage.stationsTargeted}</span>{' '}
            stations ({coverage.stationPct.toFixed(1)}% of {coverage.distinctStations.toLocaleString()} stations with records) account for{' '}
            <span className="font-bold text-primary">{coverage.violationPct.toFixed(1)}%</span>{' '}
            of all recorded violations —{' '}
            <span className="font-semibold">{coverage.violationsCovered.toLocaleString()}</span>{' '}
            of {coverage.overallTotal.toLocaleString()}.
          </p>
        </div>
      )}

      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Computing recommendations…</div>
        ) : (
          <div className="divide-y">
            {rows.map((r, i) => {
              const pri = priorityFor(i);
              return (
                <div
                  key={`${r.station}-${i}`}
                  className="px-4 py-3 hover:bg-muted/40 transition-colors group flex items-center gap-3"
                >
                  {/* Rank */}
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                    {i + 1}
                  </div>

                  {/* Fixed-width priority column so all station names align */}
                  <div className="w-20 shrink-0 flex justify-center">
                    <Badge className={`${pri.cls} text-[10px] px-2 py-0.5 w-full justify-center font-semibold tracking-wide`}>
                      {pri.label}
                    </Badge>
                  </div>

                  {/* Station + peak window */}
                  <button
                    type="button"
                    onClick={() => onJumpToWindow?.({ hourRange: [r.windowStart, r.windowEnd], dayOfWeek: String(r.peakDow) })}
                    className="flex-1 min-w-0 text-left"
                    title="Load this station's peak window into the map"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{r.station}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1 leading-tight pl-[18px]">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>Peak: {DAY_NAMES[r.peakDow]} · {String(r.windowStart).padStart(2,'0')}:00–{String(r.windowEnd).padStart(2,'0')}:00</span>
                    </div>
                  </button>

                  {/* Count */}
                  <div className="w-20 shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums leading-tight">{r.total.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">violations</div>
                  </div>

                  {/* Zoom action */}
                  <div className="w-8 shrink-0 flex justify-center">
                    {r.lat && r.lng ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => onZoomToJunction?.({ lat: r.lat, lng: r.lng, name: r.station })}
                        title={`Zoom map to ${r.station}`}
                      >
                        <Crosshair className="w-4 h-4 text-primary" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
