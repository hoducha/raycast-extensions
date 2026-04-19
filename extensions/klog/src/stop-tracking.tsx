import { closeMainWindow, LaunchProps, popToRoot, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { extractErrorMessage, hasNoOpenRange, normalizeBookmark, stopTracking } from "./klog";

interface StopTrackingArguments {
  bookmark: string;
}

export default async function Command(props: LaunchProps<{ arguments: StopTrackingArguments }>) {
  const { bookmark } = props.arguments;
  const normalized = normalizeBookmark(bookmark);

  const toast = new Toast({ style: Toast.Style.Animated, title: "Stopping tracking..." });
  await toast.show();

  try {
    await stopTracking(normalized);

    toast.style = Toast.Style.Success;
    toast.title = "Tracking stopped";
    toast.message = `@${normalized}`;

    await closeMainWindow();
    popToRoot({ clearSearchBar: true });
  } catch (error) {
    if (hasNoOpenRange(error)) {
      await showFailureToast("No open time range to stop.", {
        title: "Cannot stop tracking",
      });
    } else {
      await showFailureToast(extractErrorMessage(error), {
        title: "Failed to stop tracking",
      });
    }
  }
}
