/**
 * Klog CLI integration helpers for the Todoist extension.
 *
 * Self-contained module – does not depend on the klog Raycast extension.
 * Requires the "klogPath" preference to be configured in the Todoist extension.
 */
import { exec } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { promisify } from "util";

import { getPreferenceValues } from "@raycast/api";

const execAsync = promisify(exec);

type TodoistKlogPreferences = {
  klogPath?: string;
  klogAvoidSilentCloseAfterHours?: string;
  klogSkipSessionsShorterThanMinutes?: string;
};

// ─── Preferences ─────────────────────────────────────────────────────

/**
 * Get the configured klog binary path.
 * Returns undefined when not configured (klog integration disabled).
 */
export function getKlogPath(): string | undefined {
  const prefs = getPreferenceValues<TodoistKlogPreferences>();
  return prefs.klogPath?.trim() || undefined;
}

function parseNonNegativeNumber(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw?.trim() ?? "");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function getAvoidSilentCloseAfterHours(): number {
  const prefs = getPreferenceValues<TodoistKlogPreferences>();
  return parseNonNegativeNumber(prefs.klogAvoidSilentCloseAfterHours);
}

export function getSkipSessionsShorterThanMinutes(): number {
  const prefs = getPreferenceValues<TodoistKlogPreferences>();
  return parseNonNegativeNumber(prefs.klogSkipSessionsShorterThanMinutes);
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
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const output = (err.stderr ?? "") + (err.stdout ?? "");
    if (output.includes("command not found") || err.message?.includes("ENOENT")) {
      throw new Error("klog not found. Verify the klog path in the extension preferences.");
    }
    throw error;
  }
}

// ─── Error helpers ───────────────────────────────────────────────────

export function extractErrorMessage(error: unknown): string {
  const err = error as { stderr?: string; stdout?: string; message?: string };
  // klog writes error messages to stdout (not stderr)
  const output = getCombinedOutput(err, true);

  if (output) {
    return output
      .split("\n")
      .map((line: string) => line.replace(/^Error:\s*/i, "").trim())
      .filter(Boolean)
      .join(" – ");
  }

  return err.message ?? "Unknown error";
}

export function hasOpenRangeConflict(error: unknown): boolean {
  const err = error as { stderr?: string; stdout?: string };
  return getCombinedOutput(err).includes("There is already an open range");
}

export function hasNoOpenRange(error: unknown): boolean {
  const err = error as { stderr?: string; stdout?: string };
  return getCombinedOutput(err).includes("No open time range");
}

export function hasNoSuchRecord(error: unknown): boolean {
  const err = error as { stderr?: string; stdout?: string };
  return getCombinedOutput(err).includes("No such record");
}

function getCombinedOutput(err: { stderr?: string; stdout?: string }, trimStreams = false): string {
  if (trimStreams) {
    return (err.stderr?.trim() || err.stdout?.trim()) ?? "";
  }

  return (err.stderr ?? "") + (err.stdout ?? "");
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

/**
 * Resolve a bookmark to its file path.
 * Runs: klog bookmarks info @<bookmark>
 */
export async function resolveBookmarkPath(bookmark: string): Promise<string> {
  const output = await execKlog(["bookmarks", "info", `@${bookmark}`]);
  return output.trim();
}

/** Matches klog single indentation (2-4 spaces or 1 tab). */
const INDENT_RE = /^(?:\t| {2,4})/;

/** Matches a closed time range: `<?HH:MM(am|pm)?>? - <?HH:MM(am|pm)?>? summary` */
const TIME_RANGE_RE = /<?(\d{1,2}:\d{2})(am|pm)?>?\s*-\s*<?\d{1,2}:\d{2}(am|pm)?>?\s*(.*)/;

/** Matches double-indented lines (entry summary continuation per klog spec). */
const DOUBLE_INDENT_RE = /^(?:\t\t| {4,8})\S/;

/**
 * Remove the last closed time range entry from a bookmark file,
 * but only if its summary matches the expected text.
 *
 * This is used to undo a short session right after `klog stop`.
 * The summary check prevents removing a wrong entry if the file
 * was modified between `klog stop` and this call.
 *
 * Returns true if the entry was found and removed.
 */
export async function removeLastEntry(bookmark: string, expectedSummary?: string): Promise<boolean> {
  const filePath = await resolveBookmarkPath(bookmark);
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");

  // Walk backwards to find the last closed time range entry
  let entryIndex = -1;
  let entrySummaryInline = "";

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!INDENT_RE.test(lines[i])) continue;
    const afterIndent = lines[i].replace(INDENT_RE, "");
    const match = TIME_RANGE_RE.exec(afterIndent);
    if (match) {
      entryIndex = i;
      entrySummaryInline = match[4]?.trim() ?? "";
      break;
    }
  }

  if (entryIndex === -1) return false;

  // Verify the summary matches what we expect (prevents removing wrong entry)
  if (expectedSummary && entrySummaryInline !== expectedSummary) {
    return false;
  }

  // Count any double-indented continuation lines that follow the entry
  let endIndex = entryIndex;
  for (let i = entryIndex + 1; i < lines.length; i++) {
    if (DOUBLE_INDENT_RE.test(lines[i])) {
      endIndex = i;
    } else {
      break;
    }
  }

  // Remove the entry line and any continuation lines
  lines.splice(entryIndex, endIndex - entryIndex + 1);
  await writeFile(filePath, lines.join("\n"), "utf8");
  return true;
}
