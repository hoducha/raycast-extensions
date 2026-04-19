import { KlogProject } from "../types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ProjectTotal {
  name: string;
  totalMins: number;
  tags: { tag: string; mins: number }[];
}

export interface TagTotal {
  tag: string;
  totalMins: number;
}

export interface DayTotal {
  date: string;
  totalMins: number;
  tags: { tag: string; mins: number }[];
}

export interface DateFilter {
  from?: string;
  to?: string;
}

export type DateRange =
  | "today"
  | "this-week"
  | "this-month"
  | "last-30-days"
  | "last-90-days"
  | "this-year"
  | "last-year"
  | "all";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function getDateFilter(range: DateRange): DateFilter {
  const now = new Date();

  if (range === "all") return {};

  if (range === "today") {
    const today = fmtDate(now);
    return { from: today, to: today };
  }

  if (range === "this-week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { from: fmtDate(monday), to: fmtDate(now) };
  }

  if (range === "this-month") {
    return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmtDate(now) };
  }

  if (range === "last-30-days") {
    return { from: fmtDate(daysAgo(30)), to: fmtDate(now) };
  }

  if (range === "last-90-days") {
    return { from: fmtDate(daysAgo(90)), to: fmtDate(now) };
  }

  if (range === "this-year") {
    return { from: `${now.getFullYear()}-01-01`, to: fmtDate(now) };
  }

  // last-year
  const y = now.getFullYear() - 1;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function filterProjects(projects: KlogProject[], filter: DateFilter): KlogProject[] {
  if (!filter.from && !filter.to) return projects;
  return projects.map((project) => ({
    ...project,
    data: {
      records: project.data.records.filter((record) => {
        if (filter.from && record.date < filter.from) return false;
        if (filter.to && record.date > filter.to) return false;
        return true;
      }),
    },
  }));
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export function getProjectTotals(projects: KlogProject[]): ProjectTotal[] {
  return projects
    .map((project) => {
      let totalMins = 0;
      const tagMap = new Map<string, number>();

      for (const record of project.data.records) {
        totalMins += record.total_mins;
        for (const entry of record.entries) {
          for (const tag of entry.tags ?? []) {
            tagMap.set(tag, (tagMap.get(tag) ?? 0) + entry.total_mins);
          }
        }
      }

      return {
        name: project.name,
        totalMins,
        tags: Array.from(tagMap.entries())
          .map(([tag, mins]) => ({ tag, mins }))
          .sort((a, b) => b.mins - a.mins),
      };
    })
    .filter((p) => p.totalMins > 0)
    .sort((a, b) => b.totalMins - a.totalMins);
}

export function getTagTotals(projects: KlogProject[]): TagTotal[] {
  const tagMap = new Map<string, number>();

  for (const project of projects) {
    for (const record of project.data.records) {
      for (const entry of record.entries) {
        for (const tag of entry.tags ?? []) {
          tagMap.set(tag, (tagMap.get(tag) ?? 0) + entry.total_mins);
        }
      }
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, totalMins]) => ({ tag, totalMins }))
    .filter((t) => t.totalMins > 0)
    .sort((a, b) => b.totalMins - a.totalMins);
}

export function getDailyTotals(projects: KlogProject[]): DayTotal[] {
  const dayMap = new Map<string, { totalMins: number; tagMap: Map<string, number> }>();

  for (const project of projects) {
    for (const record of project.data.records) {
      if (!dayMap.has(record.date)) {
        dayMap.set(record.date, { totalMins: 0, tagMap: new Map() });
      }
      const day = dayMap.get(record.date)!;
      day.totalMins += record.total_mins;
      for (const entry of record.entries) {
        for (const tag of entry.tags ?? []) {
          day.tagMap.set(tag, (day.tagMap.get(tag) ?? 0) + entry.total_mins);
        }
      }
    }
  }

  return Array.from(dayMap.entries())
    .map(([date, { totalMins, tagMap }]) => ({
      date,
      totalMins,
      tags: Array.from(tagMap.entries())
        .map(([tag, mins]) => ({ tag, mins }))
        .sort((a, b) => b.mins - a.mins),
    }))
    .filter((d) => d.totalMins > 0)
    .sort((a, b) => b.date.localeCompare(a.date)); // DESC: most recent first
}

export function countActiveDays(projects: KlogProject[]): number {
  const dates = new Set<string>();
  for (const project of projects) {
    for (const record of project.data.records) {
      if (record.total_mins > 0) dates.add(record.date);
    }
  }
  return dates.size;
}

// ─── Duration formatting ──────────────────────────────────────────────────────

export function formatDuration(mins: number): string {
  if (mins <= 0) return "0m";
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

// ─── Tag colors ───────────────────────────────────────────────────────────────

const TAG_COLORS = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

export function getTagColorMap(tags: string[]): Map<string, string> {
  const sorted = [...tags].sort();
  return new Map(sorted.map((tag, i) => [tag, TAG_COLORS[i % TAG_COLORS.length]]));
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const UNTAGGED_COLOR = "#e0e0e0";
const SVG_BG = "#ffffff";
const SVG_LABEL_COLOR = "#444444";
const SVG_VALUE_COLOR = "#666666";
const SVG_FONT = "system-ui,-apple-system,sans-serif";

// ─── Simple bar chart ─────────────────────────────────────────────────────────

export function generateBarChartSvg(items: { label: string; mins: number; color: string }[]): string {
  if (items.length === 0) return "";

  const max = Math.max(...items.map((i) => i.mins));
  const BAR_MAX_W = 260;
  const LABEL_W = 130;
  const ROW_H = 32;
  const PAD_H = 20;
  const PAD_V = 16;
  const VALUE_W = 60;

  const totalW = PAD_H + LABEL_W + BAR_MAX_W + VALUE_W + PAD_H;
  const totalH = PAD_V + items.length * ROW_H + PAD_V;

  const rows = items
    .map((item, i) => {
      const barW = max > 0 ? Math.max(Math.round((item.mins / max) * BAR_MAX_W), 3) : 3;
      const y = PAD_V + i * ROW_H;
      const midY = y + ROW_H / 2;
      const textY = midY + 4;

      return [
        `<text x="${PAD_H + LABEL_W - 8}" y="${textY}" text-anchor="end" font-family="${SVG_FONT}" font-size="13" fill="${SVG_LABEL_COLOR}">${escapeXml(item.label)}</text>`,
        `<rect x="${PAD_H + LABEL_W}" y="${midY - 9}" width="${barW}" height="18" fill="${item.color}" rx="4"/>`,
        `<text x="${PAD_H + LABEL_W + barW + 8}" y="${textY}" font-family="${SVG_FONT}" font-size="13" fill="${SVG_VALUE_COLOR}">${formatDuration(item.mins)}</text>`,
      ].join("\n      ");
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">
  <rect width="${totalW}" height="${totalH}" fill="${SVG_BG}" rx="10"/>
  ${rows}
</svg>`;
}

// ─── Stacked bar chart ────────────────────────────────────────────────────────

export function generateStackedBarChartSvg(
  items: {
    label: string;
    totalMins: number;
    segments: { mins: number; color: string }[];
  }[],
): string {
  if (items.length === 0) return "";

  const maxTotal = Math.max(...items.map((i) => i.totalMins));
  const BAR_MAX_W = 260;
  const LABEL_W = 130;
  const ROW_H = 32;
  const PAD_H = 20;
  const PAD_V = 16;
  const VALUE_W = 60;

  const totalW = PAD_H + LABEL_W + BAR_MAX_W + VALUE_W + PAD_H;
  const totalH = PAD_V + items.length * ROW_H + PAD_V;

  const rows = items
    .map((item, i) => {
      const barW = maxTotal > 0 ? Math.max(Math.round((item.totalMins / maxTotal) * BAR_MAX_W), 3) : 3;
      const y = PAD_V + i * ROW_H;
      const midY = y + ROW_H / 2;
      const textY = midY + 4;
      const barX = PAD_H + LABEL_W;
      const barY = midY - 9;
      const barH = 18;

      // Build colored segments, clipped to barW
      const taggedMins = item.segments.reduce((s, seg) => s + seg.mins, 0);
      const untaggedMins = Math.max(item.totalMins - taggedMins, 0);

      const allSegments = [
        ...item.segments,
        ...(untaggedMins > 0 ? [{ mins: untaggedMins, color: UNTAGGED_COLOR }] : []),
      ];

      let segX = barX;
      const rects = allSegments.map((seg) => {
        const segW = item.totalMins > 0 ? Math.round((seg.mins / item.totalMins) * barW) : 0;
        const rect = `<rect x="${segX}" y="${barY}" width="${Math.max(segW, 0)}" height="${barH}" fill="${seg.color}"/>`;
        segX += segW;
        return rect;
      });

      // Clip rect for rounded corners over the stacked rects
      const clipId = `clip-${i}`;
      const clipPath = `<clipPath id="${clipId}"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="4"/></clipPath>`;
      const stackedGroup = `<g clip-path="url(#${clipId})">${rects.join("")}</g>`;

      return [
        clipPath,
        `<text x="${barX - 8}" y="${textY}" text-anchor="end" font-family="${SVG_FONT}" font-size="13" fill="${SVG_LABEL_COLOR}">${escapeXml(item.label)}</text>`,
        stackedGroup,
        `<text x="${barX + barW + 8}" y="${textY}" font-family="${SVG_FONT}" font-size="13" fill="${SVG_VALUE_COLOR}">${formatDuration(item.totalMins)}</text>`,
      ].join("\n      ");
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">
  <rect width="${totalW}" height="${totalH}" fill="${SVG_BG}" rx="10"/>
  ${rows}
</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
