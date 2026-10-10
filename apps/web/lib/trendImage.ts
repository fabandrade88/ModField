"use client";
import { align, plotPoints, type Series } from "@modfield/series";
import uPlot, { type AlignedData } from "uplot";

/** Print colors: dark on white, the light theme's pens. */
const PRINT = {
  fg: "#111111",
  muted: "#444444",
  grid: "#cccccc",
  marker: "#0047b3",
  pens: ["#1f5fbf", "#00796b", "#2e7d32", "#5e35b1", "#0277bd", "#6b6b00", "#00695c", "#37474f"],
};

/**
 * Renders a trend to a PNG data URL for the PDF: an off-screen uPlot at a
 * fixed size, the same decimation and gap rules as the screen chart.
 */
export async function trendImage(
  pens: { label: string; unit?: string; axis: "left" | "right"; series: Series }[],
  markers: { t: number; text: string }[],
  opts: { gapMs: number; locale: string; width?: number; height?: number },
): Promise<string | undefined> {
  if (!pens.some((p) => p.series.t.length >= 2)) return undefined;
  // Drawn at twice the size it is printed, so lines and text stay sharp in the PDF.
  const width = opts.width ?? 2200;
  const height = opts.height ?? 840;
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  document.body.append(host);
  const data = align(pens.map((p) => plotPoints(p.series, { buckets: width / 2, gapMs: opts.gapMs }))) as unknown as AlignedData;
  const font = "26px Helvetica, Arial, sans-serif";
  const hasRight = pens.some((p) => p.axis === "right");
  const unitOf = (axis: "left" | "right") => [...new Set(pens.filter((p) => p.axis === axis).map((p) => p.unit).filter(Boolean))].join(" · ");
  const axis = (scale: string, side: 1 | 3): uPlot.Axis => ({
    scale,
    side,
    size: 120,
    space: 70,
    label: unitOf(scale === "y2" ? "right" : "left"),
    labelSize: 40,
    font,
    labelFont: font,
    stroke: PRINT.muted,
    grid: { stroke: PRINT.grid, width: 2, show: scale === "y" },
    ticks: { stroke: PRINT.grid, width: 2 },
  });
  try {
    const u = new uPlot(
      {
        width,
        height,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: true } },
        axes: [
          {
            font,
            size: 60,
            // Room for one time label per ~220 px at this 2x size.
            space: 220,
            stroke: PRINT.muted,
            grid: { stroke: PRINT.grid, width: 2 },
            ticks: { stroke: PRINT.grid, width: 2 },
            values: (u, splits) => {
              const span = (u.scales.x!.max ?? 0) - (u.scales.x!.min ?? 0);
              return splits.map((s) =>
                new Date(s * 1000).toLocaleString(opts.locale, {
                  hour12: false,
                  ...(span > 86_400 ? { day: "2-digit", month: "2-digit" } : {}),
                  hour: "2-digit",
                  minute: "2-digit",
                  ...(span < 600 ? { second: "2-digit" } : {}),
                }),
              );
            },
          },
          axis("y", 3),
          ...(hasRight ? [axis("y2", 1)] : []),
        ],
        series: [{}, ...pens.map((p, i) => ({ label: p.label, scale: p.axis === "right" ? "y2" : "y", stroke: PRINT.pens[i % 8], width: 3, spanGaps: false, points: { show: false } }))],
        hooks: {
          draw: [
            (u) => {
              const ctx = u.ctx;
              ctx.save();
              ctx.fillStyle = "#ffffff";
              ctx.globalCompositeOperation = "destination-over";
              ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
              ctx.globalCompositeOperation = "source-over";
              ctx.strokeStyle = PRINT.marker;
              ctx.fillStyle = PRINT.fg;
              // uPlot leaves textAlign as it drew the axes.
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
              ctx.font = "24px Helvetica, Arial, sans-serif";
              ctx.lineWidth = 2;
              ctx.setLineDash([12, 8]);
              for (const m of markers) {
                const x = u.valToPos(m.t / 1000, "x", true);
                if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
                ctx.beginPath();
                ctx.moveTo(x, u.bbox.top);
                ctx.lineTo(x, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.fillText(m.text, x + 6, u.bbox.top + 24);
              }
              ctx.restore();
              // Legend drawn into the image: the PDF has no live legend.
              ctx.save();
              ctx.font = "24px Helvetica, Arial, sans-serif";
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
              let lx = u.bbox.left;
              let ly = ctx.canvas.height - 40;
              pens.forEach((p, i) => {
                const text = p.unit ? `${p.label} (${p.unit})` : p.label;
                const w = 44 + ctx.measureText(text).width + 36;
                if (lx + w > ctx.canvas.width) {
                  lx = u.bbox.left;
                  ly += 32;
                }
                ctx.fillStyle = PRINT.pens[i % 8]!;
                ctx.fillRect(lx, ly - 12, 34, 6);
                ctx.fillStyle = PRINT.fg;
                ctx.fillText(text, lx + 44, ly - 4);
                lx += w;
              });
              ctx.restore();
            },
          ],
        },
        padding: [24, 24, 110, 12],
      },
      data,
      host,
    );
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const url = u.ctx.canvas.toDataURL("image/png");
    u.destroy();
    return url;
  } finally {
    host.remove();
  }
}

/** Raster version of an uploaded logo (react-pdf takes PNG/JPEG, not SVG). */
export async function logoToPng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 600 / Math.max(img.naturalWidth || 600, img.naturalHeight || 300));
    const w = Math.round((img.naturalWidth || 600) * scale);
    const h = Math.round((img.naturalHeight || 300) * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
