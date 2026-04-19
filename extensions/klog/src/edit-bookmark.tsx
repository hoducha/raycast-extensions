import { closeMainWindow, LaunchProps, open, popToRoot } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

import { extractErrorMessage, getEditorApp, normalizeBookmark, openWithEditor, resolveBookmarkPath } from "./klog";

interface EditBookmarkArguments {
  bookmark: string;
}

export default async function Command(props: LaunchProps<{ arguments: EditBookmarkArguments }>) {
  const { bookmark } = props.arguments;
  const normalized = normalizeBookmark(bookmark);

  try {
    const filePath = await resolveBookmarkPath(normalized);
    const editorApp = getEditorApp();

    await closeMainWindow();
    popToRoot({ clearSearchBar: true });

    if (editorApp) {
      // Use exec to run the editor binary directly (supports CLI tools and app paths)
      await openWithEditor(editorApp, filePath);
    } else {
      // Fall back to macOS default app for the file type
      await open(filePath);
    }
  } catch (error) {
    await showFailureToast(extractErrorMessage(error), { title: "Failed to open bookmark" });
  }
}
