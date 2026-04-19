import { Action, ActionPanel, Detail } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";

import { getKlogDir } from "./klog";
import { loadProjects } from "./utils/klog-json";
import {
  DateRange,
  countActiveDays,
  filterProjects,
  formatDuration,
  generateBarChartSvg,
  generateStackedBarChartSvg,
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
  "last-30-days": "Last 30 Days",
  "last-90-days": "Last 90 Days",
  "this-year": "This Year",
  "last-year": "Last Year",
  all: "All Time",
};

const DAILY_BAR_COLOR = "#76b7b2";

export default function ShowReport() {
  const [dateRange, setDateRange] = useState<DateRange>("this-week");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const klogDir = getKlogDir();

  const {
    data: allProjects,
    isLoading,
    error,
  } = usePromise(loadProjects, [klogDir], {
    execute: !!klogDir,
  });

  const { markdown, totalMins, projectTotals, tagTotals, activeDays } = useMemo(() => {
    if (!allProjects) return { markdown: "", totalMins: 0, projectTotals: [], tagTotals: [], activeDays: 0 };

    const filter = getDateFilter(dateRange);
    // Apply date filter, then optionally scope to a single project
    const dateFiltered = filterProjects(allProjects, filter);
    const projects = selectedProject ? dateFiltered.filter((p) => p.name === selectedProject) : dateFiltered;

    const projectTotals = getProjectTotals(projects);
    const tagTotals = getTagTotals(projects);
    const dailyTotals = getDailyTotals(projects);
    const activeDays = countActiveDays(projects);
    const total = projectTotals.reduce((sum, p) => sum + p.totalMins, 0);

    // Consistent tag colors across all charts
    const allTagNames = [...new Set(projectTotals.flatMap((p) => p.tags.map((t) => t.tag)))];
    const tagColorMap = getTagColorMap(allTagNames);

    const sections: string[] = [];

    // Projects chart — stacked by tag (only when showing all projects)
    if (!selectedProject && projectTotals.length > 0) {
      const svg = generateStackedBarChartSvg(
        projectTotals.map((p) => ({
          label: p.name,
          totalMins: p.totalMins,
          segments: p.tags.map((t) => ({ mins: t.mins, color: tagColorMap.get(t.tag) ?? "#888888" })),
        })),
      );
      sections.push(`## Projects\n\n![projects](${svgToDataUri(svg)})`);
    }

    // Tags chart
    if (tagTotals.length > 0) {
      const svg = generateBarChartSvg(
        tagTotals.map((t) => ({ label: t.tag, mins: t.totalMins, color: tagColorMap.get(t.tag) ?? "#888888" })),
      );
      sections.push(`## Tags\n\n![tags](${svgToDataUri(svg)})`);
    }

    // Tags per Project — one chart per project (only when showing all projects)
    if (!selectedProject) {
      const taggedProjects = projectTotals.filter((p) => p.tags.length > 0);
      if (taggedProjects.length > 0) {
        const subsections = taggedProjects.map((p) => {
          const svg = generateBarChartSvg(
            p.tags.map((t) => ({ label: t.tag, mins: t.mins, color: tagColorMap.get(t.tag) ?? "#888888" })),
          );
          return `### ${p.name}\n\n![${p.name}-tags](${svgToDataUri(svg)})`;
        });
        sections.push(`## Tags per Project\n\n${subsections.join("\n\n")}`);
      }
    }

    // Daily chart — DESC (most recent first)
    if (dailyTotals.length > 0) {
      const svg = generateBarChartSvg(
        dailyTotals.map((d) => ({ label: d.date, mins: d.totalMins, color: DAILY_BAR_COLOR })),
      );
      sections.push(`## Daily\n\n![daily](${svgToDataUri(svg)})`);
    }

    return {
      markdown: sections.length > 0 ? sections.join("\n\n---\n\n") : "No time logged for this period.",
      totalMins: total,
      projectTotals,
      tagTotals,
      activeDays,
    };
  }, [allProjects, dateRange, selectedProject]);

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

  // Build available project names for the filter menu (from unfiltered date scope)
  const availableProjects = useMemo(() => {
    if (!allProjects) return [];
    const filter = getDateFilter(dateRange);
    return getProjectTotals(filterProjects(allProjects, filter)).map((p) => p.name);
  }, [allProjects, dateRange]);

  const navigationTitle = selectedProject ? `${selectedProject} — ${DATE_RANGE_LABELS[dateRange]}` : undefined;

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      navigationTitle={navigationTitle}
      metadata={
        <Detail.Metadata>
          {selectedProject && <Detail.Metadata.Label title="Project" text={selectedProject} />}
          <Detail.Metadata.Label title="Date Range" text={DATE_RANGE_LABELS[dateRange]} />
          {totalMins > 0 && <Detail.Metadata.Label title="Total" text={formatDuration(totalMins)} />}
          {activeDays > 0 && <Detail.Metadata.Label title="Active Days" text={String(activeDays)} />}

          {!selectedProject && projectTotals.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label title="Projects" text={String(projectTotals.length)} />
              {projectTotals.map((p) => (
                <Detail.Metadata.Label key={p.name} title={p.name} text={formatDuration(p.totalMins)} />
              ))}
            </>
          )}

          {tagTotals.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label title="Tags" text={String(tagTotals.length)} />
              {tagTotals.map((t) => (
                <Detail.Metadata.Label key={t.tag} title={t.tag} text={formatDuration(t.totalMins)} />
              ))}
            </>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Submenu title="Change Date Range">
            {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((range) => (
              <Action key={range} title={DATE_RANGE_LABELS[range]} onAction={() => setDateRange(range)} />
            ))}
          </ActionPanel.Submenu>
          <ActionPanel.Submenu title="Filter by Project">
            <Action title="All Projects" onAction={() => setSelectedProject(null)} />
            {availableProjects.map((name) => (
              <Action key={name} title={name} onAction={() => setSelectedProject(name)} />
            ))}
          </ActionPanel.Submenu>
        </ActionPanel>
      }
    />
  );
}
