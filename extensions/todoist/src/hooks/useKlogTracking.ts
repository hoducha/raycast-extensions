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
  removeLastEntry,
  extractErrorMessage,
  hasOpenRangeConflict,
  hasNoOpenRange,
  hasNoSuchRecord,
  checkHasOpenRange,
} from "../helpers/klog";

type KlogTrackingState = {
  taskId: string;
  taskContent: string;
  bookmark: string;
  summary: string;
  startedAtMs?: number;
};

const EMPTY_STATE: KlogTrackingState = { taskId: "", taskContent: "", bookmark: "", summary: "", startedAtMs: undefined };

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

  /**
   * If the session was shorter than the configured minimum, remove the last
   * entry from the klog file (the one that was just stopped).
   */
  async function maybeRemoveShortSession(
    bookmark: string,
    startedAtMs: number | undefined,
    expectedSummary: string | undefined,
  ) {
    const minMinutes = getSkipSessionsShorterThanMinutes();
    if (minMinutes <= 0) return;

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
      const removed = await removeLastEntry(bookmark, expectedSummary);
      if (removed) {
        await showToast({
          style: Toast.Style.Success,
          title: "Short session removed",
          message: `Removed @${bookmark} session (${elapsedMinutes.toFixed(1)}m < ${minMinutes}m)`,
        });
      }
    }
  }

  async function startKlog(taskId: string, taskContent: string, bookmark: string, labels: string[]) {
    // Auto-stop current tracking if switching to a different task
    if (trackedTask.taskId && trackedTask.taskId !== taskId) {
      // First, check if the previously tracked task is still running in klog.
      // If the user manually edited the file to close it, we should not enforce auto-close rules.
      const isCurrentlyRunning = await checkHasOpenRange(trackedTask.bookmark);

      if (isCurrentlyRunning) {
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

        try {
          await stopTracking(trackedTask.bookmark);
          await maybeRemoveShortSession(trackedTask.bookmark, previousStartMs, trackedTask.summary);
        } catch (error) {
          // Ignore "no open range" and "no such record" (no record for today) – proceed to start
          if (!hasNoOpenRange(error) && !hasNoSuchRecord(error)) {
            await showFailureToast(extractErrorMessage(error), {
              title: "Failed to stop previous tracking",
            });
            return;
          }
        }
      }
    }

    const summary = buildKlogSummary(taskContent, labels);
    await showToast({ style: Toast.Style.Animated, title: "Starting klog tracking..." });

    try {
      await startTracking(summary, bookmark);
      setTrackedTask({ taskId, taskContent, bookmark, summary, startedAtMs: Date.now() });
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

    try {
      await stopTracking(trackedTask.bookmark);
      await maybeRemoveShortSession(trackedTask.bookmark, startedAtMs, trackedTask.summary);
      setTrackedTask(EMPTY_STATE);
      await showToast({ style: Toast.Style.Success, title: "Klog tracking stopped" });
    } catch (error) {
      if (hasNoOpenRange(error) || hasNoSuchRecord(error)) {
        // Already stopped externally or no record exists – just clear the UI state
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
