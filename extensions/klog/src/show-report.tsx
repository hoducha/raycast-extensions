import { Action, ActionPanel, Detail } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";

import { getKlogDir } from "./klog";
import { loadProjects } from "./utils/klog-json";
import {
  DateRange,
  filterProjects,
  formatDuration,
  generateBarChartSvg,
  getDateFilter,
  getDailyTotals,
  getProjectTotals,
  getTagColorMap,
  getTagTotals,
  svgToDataUri,
} from "./utils/reports";

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  today: "Today",
  "this-week": "This Week",
  "this-month": "This Month",
  "last-month": "Last Month",
  all: "All Time",
};

const DAILY_BAR_COLOR = "#76b7b2";

export default function ShowReport() {
  const [dateRange, setDateRange] = useState<DateRange>("this-week");
  const klogDir = getKlogDir();

  const {
    data: allProjects,
    isLoading,
    error,
  } = usePromise(loadProjects, [klogDir], {
    execute: !!klogDir,
  });

  const { markdown, totalMins } = useMemo(() => {
    if (!allProjects) return { markdown: "", totalMins: 0 };

    const filter = getDateFilter(dateRange);
    const projects = filterProjects(allProjects, filter);

    const projectTotals = getProjectTotals(projects);
    const tagTotals = getTagTotals(projects);
    const dailyTotals = getDailyTotals(projects);

    const projectColorMap = getTagColorMap(projectTotals.map((p) => p.name));
    const tagColorMap = getTagColorMap(tagTotals.map((t) => t.tag));

    const total = projectTotals.reduce((sum, p) => sum + p.totalMins, 0);

    const sections: string[] = [];

    if (projectTotals.length > 0) {
      const svg = generateBarChartSvg(
        projectTotals.map((p) => ({
          label: p.name,
          mins: p.totalMins,
          color: projectColorMap.get(p.name) ?? "#888888",
        })),
      );
      sections.push(`## Projects\n\n![projects](${svgToDataUri(svg)})`);
    }

    if (tagTotals.length > 0) {
      const svg = generateBarChartSvg(
        tagTotals.map((t) => ({ label: t.tag, mins: t.totalMins, color: tagColorMap.get(t.tag) ?? "#888888" })),
      );
      sections.push(`## Tags\n\n![tags](${svgToDataUri(svg)})`);
    }

    if (dailyTotals.length > 0) {
      const svg = generateBarChartSvg(
        dailyTotals.map((d) => ({ label: d.date, mins: d.totalMins, color: DAILY_BAR_COLOR })),
      );
      sections.push(`## Daily\n\n![daily](${svgToDataUri(svg)})`);
    }

    return {
      markdown: sections.length > 0 ? sections.join("\n\n---\n\n") : "No time logged for this period.",
      totalMins: total,
    };
  }, [allProjects, dateRange]);

  if (!klogDir) {
    return (
      <Detail
        markdown={[
          "## Setup Required",
          "",
          "Please set the **klog Directory** in the extension preferences.",
          "",
          "This is the folder containing your `.klg` time tracking files (e.g. `~/klog`).",
        ].join("\n")}
      />
    );
  }

  if (error) {
    return <Detail markdown={`## Error\n\n${error.message}`} />;
  }

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Date Range" text={DATE_RANGE_LABELS[dateRange]} />
          {totalMins > 0 && <Detail.Metadata.Label title="Total" text={formatDuration(totalMins)} />}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Submenu title="Change Date Range">
            {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((range) => (
              <Action key={range} title={DATE_RANGE_LABELS[range]} onAction={() => setDateRange(range)} />
            ))}
          </ActionPanel.Submenu>
        </ActionPanel>
      }
    />
  );
}
