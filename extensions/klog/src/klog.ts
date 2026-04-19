import { getPreferenceValues } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface KlogPreferences {
  klogPath: string;
  editorApp?: string;
}

/**
 * Extract a user-friendly error message from a klog exec failure.
 * Prefers stderr (klog's own message) over the raw exec error.
 */
export function extractErrorMessage(error: unknown): string {
  const err = error as { stderr?: string; message?: string };
  const stderr = err.stderr?.trim();

  if (stderr) {
    // Clean up klog's error format: "Error: Manipulation failed\nThere is already an open range..."
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

function isCommandNotFound(error: unknown): boolean {
  const err = error as { stderr?: string; message?: string };
  return (err.stderr?.includes("command not found") || err.message?.includes("ENOENT")) ?? false;
}

function getKlogPath(): string {
  const { klogPath } = getPreferenceValues<KlogPreferences>();
  return klogPath || "klog";
}

export function getEditorApp(): string | undefined {
  const { editorApp } = getPreferenceValues<KlogPreferences>();
  return editorApp?.trim() || undefined;
}

async function execKlog(args: string[]): Promise<string> {
  const klogBin = getKlogPath();
  const command = `${klogBin} ${args.join(" ")}`;

  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error: unknown) {
    if (isCommandNotFound(error)) {
      throw new Error(
        "klog not found. Set the absolute path in the extension preferences (e.g., /opt/homebrew/bin/klog).",
      );
    }
    throw error;
  }
}

/**
 * Open a file using a CLI editor command.
 * Runs: <editorBin> <filePath>
 */
export function openWithEditor(editorBin: string, filePath: string): void {
  exec(`"${editorBin}" "${filePath}"`);
}

// ─── Normalization helpers ───────────────────────────────────────────

/**
 * Normalize a bookmark string:
 * - Accepts "personal", "@personal", or "@Personal"
 * - Returns "personal" (without @, lowercased) for use with klog CLI
 */
export function normalizeBookmark(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

/**
 * Normalize a space-separated string of tags.
 * Each tag accepts "tag" or "#tag", returns "#tag" (lowercased).
 *
 * Example: "coding #Work" → ["#coding", "#work"]
 */
export function normalizeTags(raw: string): string[] {
  if (!raw.trim()) return [];

  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      const stripped = word.replace(/^#/, "").trim().toLowerCase();
      return `#${stripped}`;
    })
    .filter((tag) => tag !== "#");
}

/**
 * Build the summary string for klog start -s.
 * Combines task name and normalized tags.
 */
export function buildSummary(taskName: string, tags: string[]): string {
  const parts = [taskName, ...tags].filter(Boolean);
  return parts.join(" ");
}

// ─── klog CLI wrappers ───────────────────────────────────────────────

/**
 * Start a new time tracking entry.
 * Runs: klog start -s "<summary>" @<bookmark>
 */
export async function startTracking(summary: string, bookmark: string): Promise<string> {
  const normalized = normalizeBookmark(bookmark);
  return execKlog(["start", "-s", `"${summary}"`, `@${normalized}`]);
}

/**
 * Stop the current time tracking entry.
 * Runs: klog stop @<bookmark>
 */
export async function stopTracking(bookmark: string): Promise<string> {
  const normalized = normalizeBookmark(bookmark);
  return execKlog(["stop", `@${normalized}`]);
}

/**
 * Resolve a bookmark to its file path.
 * Runs: klog bookmarks info @<bookmark>
 * Returns the file path directly (e.g., "/Users/ha/klog/personal.klg")
 */
export async function resolveBookmarkPath(bookmark: string): Promise<string> {
  const normalized = normalizeBookmark(bookmark);
  const output = await execKlog(["bookmarks", "info", `@${normalized}`]);
  return output.trim();
}
