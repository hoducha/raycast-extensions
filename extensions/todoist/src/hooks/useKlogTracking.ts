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
  listBookmarks,
  findMatchingBookmark,
  buildKlogSummary,
  startTracking,
  stopTracking,
  extractErrorMessage,
  hasOpenRangeConflict,
  hasNoOpenRange,
} from "../helpers/klog";

type KlogTrackingState = {
  taskId: string;
  taskContent: string;
  bookmark: string;
};

const EMPTY_STATE: KlogTrackingState = { taskId: "", taskContent: "", bookmark: "" };

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

  async function startKlog(taskId: string, taskContent: string, bookmark: string, labels: string[]) {
    // Auto-stop current tracking if switching to a different task
    if (trackedTask.taskId && trackedTask.taskId !== taskId) {
      try {
        await stopTracking(trackedTask.bookmark);
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
      setTrackedTask({ taskId, taskContent, bookmark });
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

    try {
      await stopTracking(trackedTask.bookmark);
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
