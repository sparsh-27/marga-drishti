import React, { useState, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { HexagonLayer, HeatmapLayer } from '@deck.gl/aggregation-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useUiStore } from '@/store/useUiStore';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Home } from 'lucide-react';
import { FlyToInterpolator } from '@deck.gl/core';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const HEX_COLOR_RANGE = [
  [237, 248, 251],
  [191, 211, 230],
  [158, 188, 218],
  [140, 150, 198],
  [136, 86, 167],
  [129, 15, 124]
];

// Warm gradient used for the Congestion Impact Score view
const IMPACT_COLOR_RANGE = [
  [255, 247, 236],
  [254, 232, 200],
  [253, 187, 132],
  [252, 141, 89],
  [227, 74, 51],
  [179, 0, 0]
];

// Peak commute windows (morning + evening). Violations during these
// hours are weighted higher because they amplify congestion impact.
const PEAK_HOURS = new Set([8, 9, 10, 17, 18, 19, 20, 21]);
const SHOULDER_HOURS = new Set([7, 11, 12, 16, 22]);
const impactWeight = (hour) => {
  if (PEAK_HOURS.has(hour)) return 1.8;
  if (SHOULDER_HOURS.has(hour)) return 1.2;
  return 1.0;
};

const HOME_VIEWPORT = {
  longitude: 77.5946,
  latitude: 12.9716,
  zoom: 11,
  pitch: 0,
  bearing: 0
};

export default function MapContainer({ mapData, layerMode = 'hex', flyTo = null, showLegend = true, showReset = true }) {
  const { viewport, setViewport, isLoading } = useUiStore();
  const [hoverInfo, setHoverInfo] = useState(null);
  const [localTransition, setLocalTransition] = useState(null);

  // React to external flyTo target by patching viewport with a smooth interpolator
  React.useEffect(() => {
    if (!flyTo || flyTo.lat === undefined || flyTo.lng === undefined) return;
    setLocalTransition({
      longitude: flyTo.lng,
      latitude: flyTo.lat,
      zoom: flyTo.zoom ?? 15,
      pitch: 30,
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 })
    });
  }, [flyTo]);

  const onViewStateChange = useCallback(({ viewState }) => {
    setLocalTransition(null);
    setViewport(viewState);
  }, [setViewport]);

  const handleReset = useCallback(() => {
    setLocalTransition({
      ...HOME_VIEWPORT,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator({ speed: 2 })
    });
  }, []);

  const transformRequest = useCallback((url) => ({ url }), []);

  const layers = useMemo(() => {
    if (!mapData || mapData.length === 0) return [];

    if (layerMode === 'points') {
      return [
        new ScatterplotLayer({
          id: 'scatter-layer',
          data: mapData,
          getPosition: d => [d.longitude, d.latitude],
          getRadius: 25,
          radiusMinPixels: 2,
          radiusMaxPixels: 6,
          getFillColor: [129, 15, 124, 180],
          pickable: true,
          onHover: info => setHoverInfo(info)
        })
      ];
    }

    if (layerMode === 'heatmap') {
      return [
        new HeatmapLayer({
          id: 'heatmap-layer',
          data: mapData,
          getPosition: d => [d.longitude, d.latitude],
          getWeight: 1,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.05
        })
      ];
    }

    if (layerMode === 'impact') {
      return [
        new HexagonLayer({
          id: 'impact-layer',
          data: mapData,
          getPosition: d => [d.longitude, d.latitude],
          getColorWeight: d => impactWeight(d.hour),
          getElevationWeight: d => impactWeight(d.hour),
          colorAggregation: 'SUM',
          elevationAggregation: 'SUM',
          radius: 110,
          elevationScale: 6,
          extruded: true,
          pickable: true,
          opacity: 0.78,
          colorRange: IMPACT_COLOR_RANGE,
          onHover: info => setHoverInfo(info)
        })
      ];
    }

    // default: hex
    return [
      new HexagonLayer({
        id: 'hexagon-layer',
        data: mapData,
        getPosition: d => [d.longitude, d.latitude],
        radius: 100,
        elevationScale: 4,
        extruded: true,
        pickable: true,
        opacity: 0.7,
        colorRange: HEX_COLOR_RANGE,
        onHover: info => setHoverInfo(info)
      })
    ];
  }, [mapData, layerMode]);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-border">
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}

      <DeckGL
        layers={layers}
        viewState={localTransition ? { ...viewport, ...localTransition } : viewport}
        onViewStateChange={onViewStateChange}
        controller={true}
        getCursor={({ isDragging }) => isDragging ? 'grabbing' : 'grab'}
      >
        <Map
          mapStyle={MAP_STYLE}
          transformRequest={transformRequest}
        />
      </DeckGL>

      {/* Reset viewport */}
      {showReset && (
        <button
          onClick={handleReset}
          title="Reset to Bengaluru view"
          className="absolute top-3 right-3 z-30 h-8 w-8 flex items-center justify-center rounded-md bg-background/90 backdrop-blur border border-border shadow hover:bg-muted transition-colors"
        >
          <Home className="w-4 h-4 text-foreground" />
        </button>
      )}

      {/* Legend */}
      {showLegend && layerMode !== 'points' && (() => {
        const isImpact = layerMode === 'impact';
        const isHeat = layerMode === 'heatmap';
        const gradient = isImpact
          ? 'linear-gradient(to right, rgb(255,247,236), rgb(252,141,89), rgb(179,0,0))'
          : isHeat
            ? 'linear-gradient(to right, rgba(33,102,172,0.0), rgba(178,24,43,0.9))'
            : 'linear-gradient(to right, rgb(237,248,251), rgb(140,150,198), rgb(129,15,124))';
        const title = isImpact ? 'Congestion Impact' : isHeat ? 'Violation Density' : 'Violation Count';
        const rightLabel = isImpact ? 'High (peak ×1.8)' : 'High';
        return (
          <div className="absolute bottom-3 right-3 z-30 bg-background/90 backdrop-blur border border-border rounded-md shadow px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
            <div className="h-2 w-32 rounded" style={{ background: gradient }} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Low</span>
              <span>{rightLabel}</span>
            </div>
          </div>
        );
      })()}

      {hoverInfo && hoverInfo.object && layerMode !== 'heatmap' && (() => {
        const obj = hoverInfo.object;
        // HexagonLayer points: array of { source: <original row> }
        // Scatterplot: the object itself is the row
        const points = obj.points || (obj.longitude !== undefined ? [{ source: obj }] : []);
        const rows = points.map(p => p.source || p);
        const count = obj.pointCount ?? points.length ?? 1;

        const tally = (key) => {
          const counts = Object.create(null);
          for (const r of rows) {
            const v = r?.[key];
            if (!v) continue;
            counts[v] = (counts[v] || 0) + 1;
          }
          return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        };
        const topStations = tally('policeStation');
        const peakShare = rows.length
          ? Math.round(rows.filter(r => PEAK_HOURS.has(r?.hour)).length / rows.length * 100)
          : 0;

        return (
          <div className="absolute z-40 pointer-events-none" style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}>
            <Card className="shadow-xl border-muted bg-background/95 backdrop-blur min-w-[220px] max-w-[300px]">
              <CardContent className="p-3 text-sm flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                  <span className="font-semibold text-primary">
                    {layerMode === 'impact' ? 'Congestion Impact' : 'Traffic Violations'}
                  </span>
                  <span className="font-mono font-bold text-destructive">{count.toLocaleString()}</span>
                </div>

                {topStations.length > 0 ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Top Police Stations</div>
                    {topStations.map(([name, n]) => (
                      <div key={name} className="flex justify-between text-xs gap-3">
                        <span className="truncate" title={name}>{name}</span>
                        <span className="font-mono text-muted-foreground">{n}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">No station tagged in this area</div>
                )}

                {layerMode === 'impact' && (
                  <div className="text-[11px] text-muted-foreground border-t pt-1.5">
                    Peak-hour share: <span className="font-mono font-semibold text-foreground">{peakShare}%</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
