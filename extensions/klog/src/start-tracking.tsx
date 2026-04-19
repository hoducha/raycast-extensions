import { closeMainWindow, LaunchProps, popToRoot, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { buildSummary, extractErrorMessage, hasOpenRangeConflict, normalizeBookmark, normalizeTags, startTracking } from "./klog";

interface StartTrackingArguments {
  text: string;
  tags?: string;
  bookmark: string;
}

export default async function Command(props: LaunchProps<{ arguments: StartTrackingArguments }>) {
  const { text, tags: rawTags, bookmark } = props.arguments;

  const taskName = text.trim();
  const tags = normalizeTags(rawTags ?? "");
  const summary = buildSummary(taskName, tags);
  const normalizedBookmark = normalizeBookmark(bookmark);

  const toast = new Toast({ style: Toast.Style.Animated, title: "Starting tracking..." });
  await toast.show();

  try {
    await startTracking(summary, normalizedBookmark);

    toast.style = Toast.Style.Success;
    toast.title = "Tracking started";
    toast.message = `${summary} @${normalizedBookmark}`;

    await closeMainWindow();
    popToRoot({ clearSearchBar: true });
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
