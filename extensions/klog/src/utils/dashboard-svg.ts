import { formatDuration } from "./reports";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SVG_FONT = "system-ui,-apple-system,sans-serif";
const UNTAGGED_COLOR = "#e0e0e0";

// ─── Appearance-aware palette ─────────────────────────────────────────────────

interface Palette {
  bg: string;
  title: string;
  stat: string;
  sectionTitle: string;
  subsectionTitle: string;
  label: string;
  value: string;
  divider: string;
}

const LIGHT: Palette = {
  bg: "#ffffff",
  title: "#111111",
  stat: "#555555",
  sectionTitle: "#1a1a1a",
  subsectionTitle: "#777777",
  label: "#444444",
  value: "#666666",
  divider: "#eeeeee",
};

const DARK: Palette = {
  bg: "#1c1c1e",
  title: "#f2f2f7",
  stat: "#aeaeb2",
  sectionTitle: "#e5e5ea",
  subsectionTitle: "#8e8e93",
  label: "#c7c7cc",
  value: "#8e8e93",
  divider: "#38383a",
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
  daily?: DashboardBarItem[];
} & (
  | { mode: "all-projects"; projects: DashboardStackedItem[]; tagsPerProject: DashboardProjectGroup[] }
  | { mode: "single-project"; projectTagBreakdown: DashboardBarItem[] }
);

// ─── Layout constants ─────────────────────────────────────────────────────────

const DASH_W = 660;
const DASH_PAD_H = 20;
const DASH_PAD_V = 22;
const DASH_COL_GAP = 44;
const DASH_COL_W = Math.floor((DASH_W - 2 * DASH_PAD_H - DASH_COL_GAP) / 2); // 288

const DASH_LABEL_W = 82;
const DASH_BAR_X = DASH_LABEL_W + 6;
const DASH_BAR_MAX_W = 148;
const DASH_ROW_H = 22;
const DASH_SECTION_TITLE_H = 22;
const DASH_PRE_TITLE_GAP = 14;
const DASH_SUBSECTION_H = 20;

// ─── Column builder ───────────────────────────────────────────────────────────

function makeColumn(idPrefix: string, clipCounter: { n: number }, p: Palette) {
  const parts: string[] = [];
  let y = 0;

  function addSummary(summary: DashboardSummary) {
    if (summary.subtitle) {
      // Single-project mode: subtitle is the date range, title is the project name
      parts.push(
        `<text x="0" y="${y + 18}" font-family="${SVG_FONT}" font-size="18" font-weight="700" fill="${p.title}">${escapeXml(summary.title)}</text>`,
      );
      y += 26;
      parts.push(
        `<text x="0" y="${y + 13}" font-family="${SVG_FONT}" font-size="13" fill="${p.stat}">${escapeXml(summary.subtitle)}</text>`,
      );
      y += 20;
    } else {
      // All-projects mode: title is the date range
      parts.push(
        `<text x="0" y="${y + 18}" font-family="${SVG_FONT}" font-size="18" font-weight="700" fill="${p.title}">${escapeXml(summary.title)}</text>`,
      );
      y += 28;
    }

    const statParts: string[] = [];
    if (summary.totalMins > 0) statParts.push(`${formatDuration(summary.totalMins)} total`);
    if (summary.activeDays > 0) statParts.push(`${summary.activeDays} active ${summary.activeDays === 1 ? "day" : "days"}`);

    if (statParts.length > 0) {
      parts.push(
        `<text x="0" y="${y + 14}" font-family="${SVG_FONT}" font-size="13" font-weight="500" fill="${p.stat}">${escapeXml(statParts.join("   ·   "))}</text>`,
      );
      y += 20;
    }
  }

  function addDivider() {
    y += 10;
    parts.push(`<line x1="0" y1="${y}" x2="${DASH_COL_W}" y2="${y}" stroke="${p.divider}" stroke-width="1"/>`);
    y += 12;
  }

  function addSectionTitle(title: string) {
    y += DASH_PRE_TITLE_GAP;
    parts.push(
      `<text x="0" y="${y + 12}" font-family="${SVG_FONT}" font-size="11" font-weight="700" fill="${p.sectionTitle}" letter-spacing="0.8">${escapeXml(title.toUpperCase())}</text>`,
    );
    y += DASH_SECTION_TITLE_H;
  }

  function addSubsectionTitle(title: string) {
    y += 6;
    parts.push(
      `<text x="0" y="${y + 12}" font-family="${SVG_FONT}" font-size="12" font-weight="600" fill="${p.subsectionTitle}">${escapeXml(title)}</text>`,
    );
    y += DASH_SUBSECTION_H;
  }

  function addBarRows(items: DashboardBarItem[]) {
    const max = Math.max(...items.map((i) => i.mins));
    for (const item of items) {
      const barW = max > 0 ? Math.max(Math.round((item.mins / max) * DASH_BAR_MAX_W), 3) : 3;
      const midY = y + DASH_ROW_H / 2;
      const textY = midY + 4;
      parts.push(
        `<text x="${DASH_LABEL_W}" y="${textY}" text-anchor="end" font-family="${SVG_FONT}" font-size="12" fill="${p.label}">${escapeXml(item.label)}</text>`,
        `<rect x="${DASH_BAR_X}" y="${midY - 7}" width="${barW}" height="14" fill="${item.color}" rx="3"/>`,
        `<text x="${DASH_BAR_X + barW + 5}" y="${textY}" font-family="${SVG_FONT}" font-size="12" fill="${p.value}">${formatDuration(item.mins)}</text>`,
      );
      y += DASH_ROW_H;
    }
  }

  function addStackedBarRows(items: DashboardStackedItem[]) {
    const maxTotal = Math.max(...items.map((i) => i.totalMins));
    for (const item of items) {
      const barW = maxTotal > 0 ? Math.max(Math.round((item.totalMins / maxTotal) * DASH_BAR_MAX_W), 3) : 3;
      const midY = y + DASH_ROW_H / 2;
      const textY = midY + 4;
      const barY = midY - 7;
      const barH = 14;

      const taggedMins = item.segments.reduce((s, seg) => s + seg.mins, 0);
      const untaggedMins = Math.max(item.totalMins - taggedMins, 0);
      const allSegs = [...item.segments, ...(untaggedMins > 0 ? [{ mins: untaggedMins, color: UNTAGGED_COLOR }] : [])];

      const clipId = `${idPrefix}${clipCounter.n++}`;
      let segX = DASH_BAR_X;
      const rects = allSegs
        .map((seg) => {
          const segW = item.totalMins > 0 ? Math.round((seg.mins / item.totalMins) * barW) : 0;
          const r = `<rect x="${segX}" y="${barY}" width="${Math.max(segW, 0)}" height="${barH}" fill="${seg.color}"/>`;
          segX += segW;
          return r;
        })
        .join("");

      parts.push(
        `<text x="${DASH_LABEL_W}" y="${textY}" text-anchor="end" font-family="${SVG_FONT}" font-size="12" fill="${p.label}">${escapeXml(item.label)}</text>`,
        `<clipPath id="${clipId}"><rect x="${DASH_BAR_X}" y="${barY}" width="${barW}" height="${barH}" rx="3"/></clipPath>`,
        `<g clip-path="url(#${clipId})">${rects}</g>`,
        `<text x="${DASH_BAR_X + barW + 5}" y="${textY}" font-family="${SVG_FONT}" font-size="12" fill="${p.value}">${formatDuration(item.totalMins)}</text>`,
      );
      y += DASH_ROW_H;
    }
  }

  return {
    get height() {
      return y;
    },
    addSummary,
    addDivider,
    addSectionTitle,
    addSubsectionTitle,
    addBarRows,
    addStackedBarRows,
    render: () => parts.join("\n"),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateDashboardSvg(data: DashboardData, appearance: "light" | "dark"): string {
  const p = appearance === "dark" ? DARK : LIGHT;
  const clipCounter = { n: 0 };
  const left = makeColumn("l", clipCounter, p);
  const right = makeColumn("r", clipCounter, p);

  // ── Left column ────────────────────────────────────────────────────────────
  left.addSummary(data.summary);

  if (data.mode === "single-project") {
    if (data.projectTagBreakdown.length > 0) {
      left.addDivider();
      left.addSectionTitle("Tags");
      left.addBarRows(data.projectTagBreakdown);
    }
  } else {
    if (data.projects.length > 0) {
      left.addDivider();
      left.addSectionTitle("Projects");
      left.addStackedBarRows(data.projects);
    }
    if (data.tagsPerProject.length > 0) {
      left.addDivider();
      left.addSectionTitle("Tags per Project");
      for (const group of data.tagsPerProject) {
        left.addSubsectionTitle(`${group.projectName} (${formatDuration(group.projectTotal)})`);
        left.addBarRows(group.items);
      }
    }
  }

  // ── Right column ───────────────────────────────────────────────────────────
  const showRightTags = data.mode === "all-projects" && data.tags && data.tags.length > 0;

  if (showRightTags && data.tags) {
    right.addSectionTitle("Tags");
    right.addBarRows(data.tags);
  }

  if (data.daily && data.daily.length > 0) {
    if (showRightTags) right.addDivider();
    right.addSectionTitle("Daily");
    right.addBarRows(data.daily);
  }

  // ── Compose ────────────────────────────────────────────────────────────────
  const totalH = Math.max(left.height, right.height) + DASH_PAD_V * 2;
  const rightX = DASH_PAD_H + DASH_COL_W + DASH_COL_GAP;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DASH_W}" height="${totalH}">
  <rect width="${DASH_W}" height="${totalH}" fill="${p.bg}" rx="10"/>
  <g transform="translate(${DASH_PAD_H},${DASH_PAD_V})">${left.render()}</g>
  <g transform="translate(${rightX},${DASH_PAD_V})">${right.render()}</g>
</svg>`;
}
