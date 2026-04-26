/**
 * Hooks for klog time tracking state management.
 *
 * - useKlogTracking()      – full hook with actions (for TaskActions)
 * - useKlogTrackingState() – read-only state (for TaskListItem, lightweight)
 */
import { Toast, showToast } from "@raycast/api";
import { useCachedState, showFailureToast } from "@raycast/utils";
import { useEffect } from "react";

import {
  getKlogPath,
  getAvoidSilentCloseAfterHours,
  getSkipSessionsShorterThanMinutes,
  listBookmarks,
  findMatchingBookmark,
  buildKlogSummary,
  startTracking,
  stopTracking,
  snapshotBookmarkFile,
  restoreBookmarkSnapshot,
  extractErrorMessage,
  hasOpenRangeConflict,
  hasNoOpenRange,
} from "../helpers/klog";

type KlogTrackingState = {
  taskId: string;
  taskContent: string;
  bookmark: string;
  startedAtMs?: number;
};

const EMPTY_STATE: KlogTrackingState = { taskId: "", taskContent: "", bookmark: "", startedAtMs: undefined };

// ─── Full hook (TaskActions) ─────────────────────────────────────────

export function useKlogTracking() {
  const [trackedTask, setTrackedTask] = useCachedState<KlogTrackingState>("klog.trackedTask", EMPTY_STATE);
  const [bookmarks, setBookmarks] = useCachedState<string[]>("klog.bookmarks", []);

  const klogEnabled = Boolean(getKlogPath());

  // Load bookmarks once on mount when klog is configured
  useEffect(() => {
    if (!klogEnabled) return;
    listBookmarks()
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
  }, [klogEnabled]);

  function isTrackingTask(taskId: string): boolean {
    return trackedTask.taskId === taskId;
  }

  function getBookmarkForProject(projectName: string): string | undefined {
    return findMatchingBookmark(bookmarks, projectName);
  }

  function getTrackedTaskStartMs(): number | undefined {
    if (typeof trackedTask.startedAtMs === "number" && Number.isFinite(trackedTask.startedAtMs)) {
      return trackedTask.startedAtMs;
    }
    return undefined;
  }

  async function maybeRollbackShortSession(
    bookmark: string,
    startedAtMs: number | undefined,
    snapshot: string | undefined,
  ) {
    const minMinutes = getSkipSessionsShorterThanMinutes();
    if (minMinutes <= 0 || !snapshot) return;

    if (typeof startedAtMs !== "number") {
      await showToast({
        style: Toast.Style.Failure,
        title: "Unable to filter short session",
        message: `Missing start time metadata for @${bookmark}`,
      });
      return;
    }

    const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
    if (elapsedMinutes < minMinutes) {
      await restoreBookmarkSnapshot(bookmark, snapshot);
      await showToast({
        style: Toast.Style.Success,
        title: "Short session removed",
        message: `Removed @${bookmark} session (${elapsedMinutes.toFixed(1)}m < ${minMinutes}m)`,
      });
    }
  }

  async function startKlog(taskId: string, taskContent: string, bookmark: string, labels: string[]) {
    // Auto-stop current tracking if switching to a different task
    if (trackedTask.taskId && trackedTask.taskId !== taskId) {
      const previousStartMs = getTrackedTaskStartMs();
      const maxSilentCloseHours = getAvoidSilentCloseAfterHours();

      if (maxSilentCloseHours > 0) {
        if (typeof previousStartMs !== "number") {
          await showFailureToast(
            `Cannot auto-close tracked task "${trackedTask.taskContent}" @${trackedTask.bookmark} because start time is unknown. Edit the klog file manually before starting a new task.`,
            { title: "Cannot safely auto-close previous tracking" },
          );
          return;
        }

        const elapsedHours = (Date.now() - previousStartMs) / 3600000;
        if (elapsedHours > maxSilentCloseHours) {
          await showFailureToast(
            `Cannot auto-close tracked task "${trackedTask.taskContent}" @${trackedTask.bookmark} because it has been running for ${elapsedHours.toFixed(1)}h. Edit the klog file manually before starting a new task.`,
            { title: "Cannot safely auto-close previous tracking" },
          );
          return;
        }
      }

      let previousSnapshot: string | undefined;
      try {
        previousSnapshot = await snapshotBookmarkFile(trackedTask.bookmark);
        await stopTracking(trackedTask.bookmark);
        await maybeRollbackShortSession(trackedTask.bookmark, previousStartMs, previousSnapshot);
      } catch (error) {
        // Ignore "no open range" (already stopped) but surface other errors
        if (!hasNoOpenRange(error)) {
          await showFailureToast(extractErrorMessage(error), {
            title: "Failed to stop previous tracking",
          });
          return;
        }
      }
    }

    const summary = buildKlogSummary(taskContent, labels);
    await showToast({ style: Toast.Style.Animated, title: "Starting klog tracking..." });

    try {
      await startTracking(summary, bookmark);
      setTrackedTask({ taskId, taskContent, bookmark, startedAtMs: Date.now() });
      await showToast({
        style: Toast.Style.Success,
        title: "Klog tracking started",
        message: `${summary} @${bookmark}`,
      });
    } catch (error) {
      if (hasOpenRangeConflict(error)) {
        await showFailureToast("There is already an open range. Stop it first.", {
          title: "Cannot start tracking",
        });
      } else {
        await showFailureToast(extractErrorMessage(error), {
          title: "Failed to start tracking",
        });
      }
    }
  }

  async function stopKlog() {
    if (!trackedTask.taskId) return;

    await showToast({ style: Toast.Style.Animated, title: "Stopping klog tracking..." });

    const startedAtMs = getTrackedTaskStartMs();
    let snapshot: string | undefined;

    try {
      snapshot = await snapshotBookmarkFile(trackedTask.bookmark);
      await stopTracking(trackedTask.bookmark);
      await maybeRollbackShortSession(trackedTask.bookmark, startedAtMs, snapshot);
      setTrackedTask(EMPTY_STATE);
      await showToast({ style: Toast.Style.Success, title: "Klog tracking stopped" });
    } catch (error) {
      if (hasNoOpenRange(error)) {
        // Already stopped externally – just clear the UI state
        setTrackedTask(EMPTY_STATE);
        await showToast({ style: Toast.Style.Success, title: "Klog tracking stopped" });
      } else {
        await showFailureToast(extractErrorMessage(error), {
          title: "Failed to stop tracking",
        });
      }
    }
  }

  return {
    trackedTask,
    klogEnabled,
    bookmarks,
    isTrackingTask,
    getBookmarkForProject,
    startKlog,
    stopKlog,
  };
}

// ─── Read-only hook (TaskListItem) ───────────────────────────────────

/**
 * Lightweight hook that only reads the klog tracking state.
 * No side effects – safe to use in every TaskListItem instance.
 */
export function useKlogTrackingState() {
  const [trackedTask] = useCachedState<KlogTrackingState>("klog.trackedTask", EMPTY_STATE);
  const klogEnabled = Boolean(getKlogPath());
  return { trackedTask, klogEnabled };
}
