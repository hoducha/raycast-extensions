import { formatDuration } from "./reports";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SVG_FONT = "system-ui,-apple-system,sans-serif";

// ─── Palette ─────────────────────────────────────────────────────────────────

interface Palette {
  title: string;
  stat: string;
  sectionTitle: string;
  projectName: string;
  label: string;
  value: string;
  divider: string;
  track: string;
  untagged: string;
}

const LIGHT: Palette = {
  title: "#111111",
  stat: "#555555",
  sectionTitle: "#888888",
  projectName: "#111111",
  label: "#333333",
  value: "#555555",
  divider: "#c8c8c8",
  track: "#d8d8d8",   // clearly darker than the gray Raycast panel → visible as bar background
  untagged: "#b4b4b4", // darker than track → readable as a filled segment
};

const DARK: Palette = {
  title: "#f5f5f7",
  stat: "#a0a0a5",
  sectionTitle: "#606065",
  projectName: "#f5f5f7",
  label: "#c0c0c5",
  value: "#909095",
  divider: "#424246",
  track: "#3e3e42",   // clearly lighter than the dark Raycast panel → visible as bar background
  untagged: "#585860", // lighter than track → readable as a filled segment
};

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DashboardBarItem {
  label: string;
  mins: number;
  color: string;
}

export interface DashboardStackedItem {
  label: string;
  totalMins: number;
  segments: { mins: number; color: string }[];
}

export interface DashboardProjectGroup {
  projectName: string;
  projectTotal: number;
  items: DashboardBarItem[];
}

export interface DashboardSummary {
  title: string;
  subtitle?: string;
  totalMins: number;
  activeDays: number;
}

export type DashboardData = {
  summary: DashboardSummary;
  tags?: DashboardBarItem[];
  daily?: DashboardStackedItem[];
} & (
  | { mode: "all-projects"; projects: DashboardStackedItem[]; tagsPerProject: DashboardProjectGroup[] }
  | { mode: "single-project"; projectTagBreakdown: DashboardBarItem[] }
);

// ─── Layout constants ─────────────────────────────────────────────────────────

const W = 720;
const PAD_L = 20;
const PAD_V = 20;
const INDENT = 12;

// Both columns are equal: label 70 + gap 6 + bar 200 + gap 8 + value ~35 ≈ 319px each
// Left column (relative to translate(PAD_L, contentY))
const L_BAR_X = 76; // label 70 + gap 6
const L_BAR_W = 200;
const L_VAL_X = 284; // L_BAR_X + L_BAR_W + 8

// Vertical divider — ~21px right of left-col content end (20 + 284 + 35 ≈ 339)
const DIVIDER_X = 360;

// Right column (relative to translate(R_ORIGIN, contentY))
// right-col content right edge ≈ 378 + 284 + 35 = 697 → 23px right margin
const R_ORIGIN = 378;
const R_BAR_X = 76; // label 70 + gap 6
const R_BAR_W = 200;
const R_VAL_X = 284; // R_BAR_X + R_BAR_W + 8

// Row sizing
const ROW_H = 28;
const BAR_H = 20;
const BAR_RX = 4;

// Spacing
const SECTION_GAP = 16;
const SECTION_H = 20;
const PROJ_GAP = 10;
const PROJ_H = 22;
const SEP_PRE = 10;
const SEP_POST = 12;

// ─── Column builder ───────────────────────────────────────────────────────────

function makeCol(barX: number, barW: number, valX: number, idPfx: string, clip: { n: number }, p: Palette) {
  const el: string[] = [];
  const defs: string[] = []; // clipPaths collected here → placed in <defs> in the final SVG
  let y = 0;

  const sepW = barX + barW + 40;

  function secTitle(t: string) {
    y += SECTION_GAP;
    el.push(
      `<text x="0" y="${y + 12}" font-family="${SVG_FONT}" font-size="11" font-weight="500" ` +
        `fill="${p.sectionTitle}" letter-spacing="0.08em">${escapeXml(t.toUpperCase())}</text>`,
    );
    y += SECTION_H;
  }

  function sep() {
    y += SEP_PRE;
    el.push(`<line x1="0" y1="${y}" x2="${sepW}" y2="${y}" stroke="${p.divider}" stroke-width="0.5"/>`);
    y += SEP_POST;
  }

  function projHeader(name: string) {
    y += PROJ_GAP;
    el.push(
      `<text x="0" y="${y + 13}" font-family="${SVG_FONT}" font-size="13" font-weight="600" fill="${p.projectName}">${escapeXml(name)}</text>`,
    );
    y += PROJ_H;
  }

  function simpleBar(label: string, mins: number, color: string, maxMins: number, indent = 0) {
    const bw = maxMins > 0 ? Math.max(Math.round((mins / maxMins) * barW), 3) : 3;
    const by = y + Math.round((ROW_H - BAR_H) / 2);
    const ty = y + Math.round(ROW_H / 2) + 4;
    el.push(
      `<text x="${indent}" y="${ty}" font-family="${SVG_FONT}" font-size="12" fill="${p.label}">${escapeXml(label)}</text>`,
      `<rect x="${barX}" y="${by}" width="${barW}" height="${BAR_H}" fill="${p.track}" rx="${BAR_RX}"/>`,
      `<rect x="${barX}" y="${by}" width="${bw}" height="${BAR_H}" fill="${color}" rx="${BAR_RX}"/>`,
      `<text x="${valX}" y="${ty}" font-family="${SVG_FONT}" font-size="12" fill="${p.value}">${formatDuration(mins)}</text>`,
    );
    y += ROW_H;
  }

  function simpleBarRows(items: DashboardBarItem[], indent = 0) {
    const max = items.reduce((m, i) => Math.max(m, i.mins), 0);
    for (const item of items) simpleBar(item.label, item.mins, item.color, max, indent);
  }

  function stackedBarRows(items: DashboardStackedItem[]) {
    const maxTotal = items.reduce((m, i) => Math.max(m, i.totalMins), 0);
    for (const item of items) {
      const bw = maxTotal > 0 ? Math.max(Math.round((item.totalMins / maxTotal) * barW), 3) : 3;
      const by = y + Math.round((ROW_H - BAR_H) / 2);
      const ty = y + Math.round(ROW_H / 2) + 4;

      const taggedMins = item.segments.reduce((s, sg) => s + sg.mins, 0);
      const untaggedMins = Math.max(item.totalMins - taggedMins, 0);
      const segs = [...item.segments, ...(untaggedMins > 0 ? [{ mins: untaggedMins, color: p.untagged }] : [])];

      const clipId = `${idPfx}${clip.n++}`;
      // clipPath goes into <defs> so renderers can always resolve the ID reference
      defs.push(`<clipPath id="${clipId}"><rect x="${barX}" y="${by}" width="${bw}" height="${BAR_H}" rx="${BAR_RX}"/></clipPath>`);

      let sx = barX;
      const segRects = segs
        .map((sg) => {
          const sw = item.totalMins > 0 ? Math.round((sg.mins / item.totalMins) * bw) : 0;
          const r = `<rect x="${sx}" y="${by}" width="${Math.max(sw, 0)}" height="${BAR_H}" fill="${sg.color}"/>`;
          sx += sw;
          return r;
        })
        .join("");

      el.push(
        `<text x="0" y="${ty}" font-family="${SVG_FONT}" font-size="12" fill="${p.label}">${escapeXml(item.label)}</text>`,
        `<rect x="${barX}" y="${by}" width="${barW}" height="${BAR_H}" fill="${p.track}" rx="${BAR_RX}"/>`,
        `<g clip-path="url(#${clipId})">${segRects}</g>`,
        `<text x="${valX}" y="${ty}" font-family="${SVG_FONT}" font-size="12" fill="${p.value}">${formatDuration(item.totalMins)}</text>`,
      );
      y += ROW_H;
    }
  }

  return {
    get h() {
      return y;
    },
    secTitle,
    sep,
    projHeader,
    simpleBarRows,
    stackedBarRows,
    render: () => el.join("\n"),
    renderDefs: () => defs.join("\n"),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateDashboardSvg(data: DashboardData, appearance: "light" | "dark"): string {
  const p = appearance === "dark" ? DARK : LIGHT;
  const clip = { n: 0 };

  const lc = makeCol(L_BAR_X, L_BAR_W, L_VAL_X, "l", clip, p);
  const rc = makeCol(R_BAR_X, R_BAR_W, R_VAL_X, "r", clip, p);

  // ── Left column ──────────────────────────────────────────────────────────────
  if (data.mode === "single-project") {
    if (data.projectTagBreakdown.length > 0) {
      lc.secTitle("Tags");
      lc.simpleBarRows(data.projectTagBreakdown);
    }
  } else {
    if (data.projects.length > 0) {
      lc.secTitle("Projects");
      lc.stackedBarRows(data.projects);
    }
    if (data.tagsPerProject.length > 0) {
      lc.sep();
      lc.secTitle("Tags per Project");
      for (const g of data.tagsPerProject) {
        lc.projHeader(g.projectName);
        lc.simpleBarRows(g.items, INDENT);
      }
    }
  }

  // ── Right column ─────────────────────────────────────────────────────────────
  const hasTags = data.mode === "all-projects" && data.tags && data.tags.length > 0;
  if (hasTags && data.tags) {
    rc.secTitle("Tags");
    rc.simpleBarRows(data.tags);
  }
  if (data.daily && data.daily.length > 0) {
    if (hasTags) rc.sep();
    rc.secTitle("Daily");
    rc.stackedBarRows(data.daily);
  }

  // ── Header (full-width) ──────────────────────────────────────────────────────
  const hdr: string[] = [];
  let hy = PAD_V;

  hdr.push(
    `<text x="${PAD_L}" y="${hy + 22}" font-family="${SVG_FONT}" font-size="22" font-weight="500" fill="${p.title}">${escapeXml(data.summary.title)}</text>`,
  );
  hy += 30;

  const statParts: string[] = [];
  if (data.summary.subtitle) statParts.push(data.summary.subtitle);
  if (data.summary.totalMins > 0) statParts.push(`${formatDuration(data.summary.totalMins)} total`);
  if (data.summary.activeDays > 0) {
    const dayLabel = data.summary.activeDays === 1 ? "day" : "days";
    statParts.push(`${data.summary.activeDays} active ${dayLabel}`);
  }
  if (statParts.length > 0) {
    hdr.push(
      `<text x="${PAD_L}" y="${hy + 14}" font-family="${SVG_FONT}" font-size="13" fill="${p.stat}">${escapeXml(statParts.join("   ·   "))}</text>`,
    );
    hy += 20;
  }

  hy += 8;
  hdr.push(`<line x1="${PAD_L}" y1="${hy}" x2="${W - 30}" y2="${hy}" stroke="${p.divider}" stroke-width="0.5"/>`);
  hy += 16;

  const contentY = hy;
  const colH = Math.max(lc.h, rc.h);

  // ── Compose ──────────────────────────────────────────────────────────────────
  const totalH = contentY + colH + PAD_V;
  const allDefs = [lc.renderDefs(), rc.renderDefs()].filter(Boolean).join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}">`,
    allDefs ? `<defs>${allDefs}</defs>` : "",
    ...hdr,
    `<line x1="${DIVIDER_X}" y1="${contentY}" x2="${DIVIDER_X}" y2="${contentY + colH}" stroke="${p.divider}" stroke-width="0.5"/>`,
    `<g transform="translate(${PAD_L},${contentY})">${lc.render()}</g>`,
    `<g transform="translate(${R_ORIGIN},${contentY})">${rc.render()}</g>`,
    `</svg>`,
  ].filter(Boolean).join("\n");
}
