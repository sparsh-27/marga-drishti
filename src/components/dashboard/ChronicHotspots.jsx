import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flame, Crosshair } from 'lucide-react';

const BUCKET_COLOR = {
  morning: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  afternoon: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  evening: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  night: 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
};

export default function ChronicHotspots({ data, onZoomToJunction }) {
  const rows = data || [];

  return (
    <Card className="shadow-md">
      <CardHeader className="py-3 border-b bg-muted/30">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="w-4 h-4 text-destructive" />
          Chronic Stations
        </CardTitle>
        <CardDescription className="text-xs">
          Police-station jurisdictions that rank in the top 5 for 3 or more time-of-day buckets — persistent problem zones, not one-off spikes.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No chronic hotspots detected.</div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.station} className="px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-destructive/10 text-destructive text-xs font-bold shrink-0">
                  {r.bucketCount}/4
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" title={r.station}>{r.station}</div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {r.buckets.map((b) => (
                      <Badge key={b} variant="outline" className={`text-[10px] px-1.5 py-0 capitalize border-transparent ${BUCKET_COLOR[b] || ''}`}>
                        {b}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums">{r.total.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">violations</div>
                </div>
                {r.lat && r.lng && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => onZoomToJunction?.({ lat: r.lat, lng: r.lng, name: r.station })}
                    title={`Zoom map to ${r.station}`}
                  >
                    <Crosshair className="w-4 h-4 text-primary" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
