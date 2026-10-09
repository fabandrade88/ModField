"use client";
import { align, plotPoints, type Series } from "@modfield/series";
import { useEffect, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";

export interface Pen {
  tagId: string;
  label: string;
  unit?: string;
  axis: "left" | "right";
  /** 0..7, picks --c-pen-N. */
  color: number;
  series: Series;
}

export interface Range {
  from: number;
  to: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Trend chart: up to 8 pens, two Y axes, drag to zoom, cursor values in the
 * legend, markers as vertical lines. Gaps and bad samples break the line.
 */
export function TrendChart({
  pens,
  markers,
  range,
  onRange,
  gapMs,
  theme,
  height = 320,
  waiting,
  locale,
  timeLabel,
}: {
  pens: Pen[];
  markers: { t: number; text: string }[];
  range: Range | undefined;
  onRange: (r: Range | undefined) => void;
  gapMs: number;
  theme: string;
  height?: number;
  /** Shown until there are two points: uPlot cannot scale a time axis from zero or one. */
  waiting: string;
  /** Times on the axis and in the legend follow the UI language, 24 h. */
  locale: string;
  timeLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot>(undefined);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;

  // Build data from the visible range, decimated to the chart width.
  const width = () => box.current?.clientWidth ?? 800;
  const data = (): AlignedData => {
    const buckets = Math.max(200, Math.floor(width()));
    const plots = pens.map((p) => plotPoints(p.series, { from: range?.from, to: range?.to, buckets, gapMs }));
    return align(plots) as unknown as AlignedData;
  };

  const points = pens.reduce((n, p) => Math.max(n, p.series.t.length), 0);
  const ready = points >= 2;

  // (Re)create the chart when pens, axes or the theme change.
  const shape = pens.map((p) => `${p.tagId}:${p.axis}:${p.color}`).join("|");
  useEffect(() => {
    const el = box.current;
    if (!el || !ready) return;
    const fg = css("--c-fg");
    const muted = css("--c-muted");
    const grid = css("--c-border");
    const accent = css("--c-accent");
    const font = `12px ${getComputedStyle(document.body).fontFamily}`;
    const hasRight = pens.some((p) => p.axis === "right");
    const unitOf = (axis: "left" | "right") => [...new Set(pens.filter((p) => p.axis === axis).map((p) => p.unit).filter(Boolean))].join(" · ");
    const axis = (scale: string, side: 1 | 3, label: string): uPlot.Axis => ({
      scale,
      side,
      label,
      labelFont: font,
      font,
      stroke: muted,
      grid: { stroke: grid, width: 1, show: scale === "y" },
      ticks: { stroke: grid, width: 1 },
      size: 64,
    });
    const opts: Options = {
      width: width(),
      height,
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      select: { show: true, left: 0, top: 0, width: 0, height: 0 },
      legend: { show: true, live: true },
      scales: { x: { time: true }, y: { auto: true }, y2: { auto: true } },
      axes: [
        {
          stroke: muted,
          font,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid, width: 1 },
          values: (u, splits) => {
            const span = (u.scales.x!.max ?? 0) - (u.scales.x!.min ?? 0);
            return splits.map((s) =>
              new Date(s * 1000).toLocaleString(locale, {
                hour12: false,
                ...(span > 86_400 ? { day: "2-digit", month: "2-digit" } : {}),
                hour: "2-digit",
                minute: "2-digit",
                ...(span < 600 ? { second: "2-digit" } : {}),
              }),
            );
          },
        },
        axis("y", 3, unitOf("left")),
        ...(hasRight ? [axis("y2", 1, unitOf("right"))] : []),
      ],
      series: [
        {
          label: timeLabel,
          value: (_u, v) => (v === null || v === undefined ? "—" : new Date(v * 1000).toLocaleString(locale, { hour12: false })),
        },
        ...pens.map((p) => ({
          label: p.unit ? `${p.label} (${p.unit})` : p.label,
          scale: p.axis === "right" ? "y2" : "y",
          stroke: css(`--c-pen-${p.color + 1}`),
          width: 1.5,
          spanGaps: false,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v === null || v === undefined ? "—" : String(Number(v.toPrecision(6)))),
        })),
      ],
      hooks: {
        setSelect: [
          (u) => {
            if (u.select.width < 5) return;
            const from = u.posToVal(u.select.left, "x") * 1000;
            const to = u.posToVal(u.select.left + u.select.width, "x") * 1000;
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            onRangeRef.current({ from, to });
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const [x0, x1] = [u.scales.x!.min!, u.scales.x!.max!];
            ctx.save();
            ctx.strokeStyle = accent;
            ctx.fillStyle = fg;
            ctx.font = `${11 * devicePixelRatio}px ${getComputedStyle(document.body).fontFamily}`;
            ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio]);
            for (const m of markersRef.current) {
              const xs = m.t / 1000;
              if (xs < x0 || xs > x1) continue;
              const x = u.valToPos(xs, "x", true);
              ctx.beginPath();
              ctx.moveTo(x, u.bbox.top);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.fillText(`▾ ${m.text}`, x + 3 * devicePixelRatio, u.bbox.top + 12 * devicePixelRatio);
            }
            ctx.restore();
          },
        ],
      },
    };
    plot.current?.destroy();
    plot.current = new uPlot(opts, data(), el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: width(), height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, theme, height, ready, locale]);

  // New data or range: update in place (no flicker, keeps the cursor).
  useEffect(() => {
    plot.current?.setData(data(), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pens, range, gapMs]);

  useEffect(() => {
    plot.current?.redraw(false);
  }, [markers]);

  return (
    <>
      <div ref={box} className="trend w-full" />
      {!ready && (
        <p className="flex h-32 items-center justify-center border border-dashed border-border text-muted" style={{ height }}>
          {waiting}
        </p>
      )}
    </>
  );
}
