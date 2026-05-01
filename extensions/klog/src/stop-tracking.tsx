import { closeMainWindow, LaunchProps, LocalStorage, popToRoot, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import {
  extractErrorMessage,
  getSkipSessionsShorterThanMinutes,
  hasNoOpenRange,
  hasNoSuchRecord,
  normalizeBookmark,
  removeLastEntry,
  stopTracking,
} from "./klog";

interface StopTrackingArguments {
  bookmark: string;
}

interface KlogTrackedSessionMeta {
  bookmark: string;
  summary: string;
  startedAtMs: number;
}

function parseTrackedSessionMeta(raw: string | undefined): KlogTrackedSessionMeta | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as KlogTrackedSessionMeta;
  } catch {
    return undefined;
  }
}

function getStartedAtMs(meta: KlogTrackedSessionMeta | undefined, bookmark: string): number | undefined {
  if (!meta || meta.bookmark !== bookmark) {
    return undefined;
  }

  return Number.isFinite(meta.startedAtMs) ? meta.startedAtMs : undefined;
}

export default async function Command(props: LaunchProps<{ arguments: StopTrackingArguments }>) {
  const { bookmark } = props.arguments;
  const normalized = normalizeBookmark(bookmark);

  const toast = new Toast({ style: Toast.Style.Animated, title: "Stopping tracking..." });
  await toast.show();

  try {
    await stopTracking(normalized);

    const minMinutes = getSkipSessionsShorterThanMinutes();
    const rawMeta = await LocalStorage.getItem<string>("klog.trackedSessionMeta");
    const parsedMeta = parseTrackedSessionMeta(rawMeta);
    const startedAtMs = getStartedAtMs(parsedMeta, normalized);

    if (minMinutes > 0 && typeof startedAtMs === "number") {
      const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
      if (elapsedMinutes < minMinutes) {
        const removed = await removeLastEntry(normalized, parsedMeta?.summary);
        toast.message = removed
          ? `Short session removed (${elapsedMinutes.toFixed(1)}m < ${minMinutes}m)`
          : `Stopped @${normalized} (short-session rollback skipped: no entry found)`;
      }
    } else if (minMinutes > 0) {
      toast.message = `Stopped @${normalized} (short-session filter skipped: missing start metadata)`;
    }

    await LocalStorage.removeItem("klog.trackedSessionMeta");

    toast.style = Toast.Style.Success;
    toast.title = "Tracking stopped";
    toast.message = toast.message || `@${normalized}`;

    await closeMainWindow();
    popToRoot({ clearSearchBar: true });
  } catch (error) {
    if (hasNoOpenRange(error)) {
      await LocalStorage.removeItem("klog.trackedSessionMeta");
      await showFailureToast("No open time range to stop.", {
        title: "Cannot stop tracking",
      });
    } else if (hasNoSuchRecord(error)) {
      await LocalStorage.removeItem("klog.trackedSessionMeta");
      await showFailureToast(`No record found for @${normalized}. Create a record first.`, {
        title: "Cannot stop tracking",
      });
    } else {
      await showFailureToast(extractErrorMessage(error), {
        title: "Failed to stop tracking",
      });
    }
  }
}
