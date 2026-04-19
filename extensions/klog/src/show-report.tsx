import { Action, ActionPanel, Detail, environment } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";

import { getKlogDir } from "./klog";
import { DashboardData, generateDashboardSvg } from "./utils/dashboard-svg";
import { loadProjects } from "./utils/klog-json";
import {
  DateRange,
  countActiveDays,
  filterProjects,
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

const MAX_DAILY_RECORDS = 30;
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

  const markdown = useMemo(() => {
    if (!allProjects) return "";

    const filter = getDateFilter(dateRange);
    const dateFiltered = filterProjects(allProjects, filter);
    const projects = selectedProject ? dateFiltered.filter((p) => p.name === selectedProject) : dateFiltered;

    const projectTotals = getProjectTotals(projects);
    const tagTotals = getTagTotals(projects);
    const dailyTotals = getDailyTotals(projects).slice(0, MAX_DAILY_RECORDS);
    const activeDays = countActiveDays(projects);
    const totalMins = projectTotals.reduce((sum, p) => sum + p.totalMins, 0);

    if (totalMins === 0 && dailyTotals.length === 0) {
      return "No time logged for this period.";
    }

    const allTagNames = [...new Set(projectTotals.flatMap((p) => p.tags.map((t) => t.tag)))];
    const tagColorMap = getTagColorMap(allTagNames);

    const sharedFields = {
      tags: tagTotals.map((t) => ({ label: t.tag, mins: t.totalMins, color: tagColorMap.get(t.tag) ?? "#888888" })),
      daily: dailyTotals.map((d) => ({ label: d.date, mins: d.totalMins, color: DAILY_BAR_COLOR })),
    };

    const dashData: DashboardData = selectedProject
      ? {
          mode: "single-project",
          summary: { title: selectedProject, subtitle: DATE_RANGE_LABELS[dateRange], totalMins, activeDays },
          projectTagBreakdown: (projectTotals[0]?.tags ?? []).map((t) => ({
            label: t.tag,
            mins: t.mins,
            color: tagColorMap.get(t.tag) ?? "#888888",
          })),
          ...sharedFields,
        }
      : {
          mode: "all-projects",
          summary: { title: DATE_RANGE_LABELS[dateRange], totalMins, activeDays },
          projects: projectTotals.map((p) => ({
            label: p.name,
            totalMins: p.totalMins,
            segments: p.tags.map((t) => ({ mins: t.mins, color: tagColorMap.get(t.tag) ?? "#888888" })),
          })),
          tagsPerProject: projectTotals
            .filter((p) => p.tags.length > 0)
            .map((p) => ({
              projectName: p.name,
              projectTotal: p.totalMins,
              items: p.tags.map((t) => ({ label: t.tag, mins: t.mins, color: tagColorMap.get(t.tag) ?? "#888888" })),
            })),
          ...sharedFields,
        };

    return `![dashboard](${svgToDataUri(generateDashboardSvg(dashData, environment.appearance))})`;
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
