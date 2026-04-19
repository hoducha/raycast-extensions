/**
 * Klog CLI integration helpers for the Todoist extension.
 *
 * Self-contained module – does not depend on the klog Raycast extension.
 * Requires the "klogPath" preference to be configured in the Todoist extension.
 */
import { getPreferenceValues } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ─── Preferences ─────────────────────────────────────────────────────

/**
 * Get the configured klog binary path.
 * Returns undefined when not configured (klog integration disabled).
 */
export function getKlogPath(): string | undefined {
  const prefs = getPreferenceValues<{ klogPath?: string }>();
  return prefs.klogPath?.trim() || undefined;
}

// ─── CLI execution ───────────────────────────────────────────────────

async function execKlog(args: string[]): Promise<string> {
  const klogBin = getKlogPath();
  if (!klogBin) {
    throw new Error("klog path is not configured. Set it in the extension preferences.");
  }

  const command = `${klogBin} ${args.join(" ")}`;

  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    if (err.stderr?.includes("command not found") || err.message?.includes("ENOENT")) {
      throw new Error("klog not found. Verify the klog path in the extension preferences.");
    }
    throw error;
  }
}

// ─── Error helpers ───────────────────────────────────────────────────

export function extractErrorMessage(error: unknown): string {
  const err = error as { stderr?: string; message?: string };
  const stderr = err.stderr?.trim();

  if (stderr) {
    return stderr
      .split("\n")
      .map((line: string) => line.replace(/^Error:\s*/i, "").trim())
      .filter(Boolean)
      .join(" – ");
  }

  return err.message ?? "Unknown error";
}

export function hasOpenRangeConflict(error: unknown): boolean {
  const err = error as { stderr?: string };
  return err.stderr?.includes("There is already an open range") ?? false;
}

export function hasNoOpenRange(error: unknown): boolean {
  const err = error as { stderr?: string };
  return err.stderr?.includes("No open time range") ?? false;
}

// ─── Bookmark helpers ────────────────────────────────────────────────

/**
 * List all klog bookmarks.
 * Runs: klog bookmarks list --no-style
 * Returns bookmark names without the @ prefix.
 */
export async function listBookmarks(): Promise<string[]> {
  try {
    const output = await execKlog(["bookmarks", "list"]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("@"))
      .map((line) => {
        const match = line.match(/^@(\S+)/);
        return match ? match[1] : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Find a klog bookmark that matches a Todoist project name.
 * Both sides are lowercased for comparison.
 */
export function findMatchingBookmark(bookmarks: string[], projectName: string): string | undefined {
  const normalized = projectName.toLowerCase();
  return bookmarks.find((b) => b.toLowerCase() === normalized);
}

// ─── Summary builder ─────────────────────────────────────────────────

/**
 * Build the klog summary from task content and Todoist labels.
 * Todoist labels become klog tags: ["coding", "Work"] → "#coding #work"
 */
export function buildKlogSummary(taskContent: string, labels: string[]): string {
  const tags = labels.map((label) => `#${label.toLowerCase()}`);
  return [taskContent, ...tags].filter(Boolean).join(" ");
}

// ─── klog CLI wrappers ───────────────────────────────────────────────

/**
 * Start klog time tracking.
 * Runs: klog start -s "<summary>" @<bookmark>
 */
export async function startTracking(summary: string, bookmark: string): Promise<string> {
  return execKlog(["start", "-s", `"${summary}"`, `@${bookmark}`]);
}

/**
 * Stop klog time tracking.
 * Runs: klog stop @<bookmark>
 */
export async function stopTracking(bookmark: string): Promise<string> {
  return execKlog(["stop", `@${bookmark}`]);
}
