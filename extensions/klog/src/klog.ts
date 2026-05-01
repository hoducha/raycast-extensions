import { getPreferenceValues } from "@raycast/api";
import { exec } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

interface KlogPreferences {
  klogPath: string;
  klogDir?: string;
  editorApp?: string;
  skipSessionsShorterThanMinutes?: string;
}

/**
 * Extract a user-friendly error message from a klog exec failure.
 * klog writes error messages to stdout (not stderr), so both streams are checked.
 */
export function extractErrorMessage(error: unknown): string {
  const err = error as { stderr?: string; stdout?: string; message?: string };
  // klog writes error messages to stdout (not stderr)
  const output = getCombinedOutput(err, true);

  if (output) {
    // Clean up klog's error format: "Error: Manipulation failed\nThere is already an open range..."
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

function isCommandNotFound(error: unknown): boolean {
  const err = error as { stderr?: string; stdout?: string; message?: string };
  const output = getCombinedOutput(err);
  return output.includes("command not found") || (err.message?.includes("ENOENT") ?? false);
}

function getCombinedOutput(err: { stderr?: string; stdout?: string }, trimStreams = false): string {
  if (trimStreams) {
    return (err.stderr?.trim() || err.stdout?.trim()) ?? "";
  }

  return (err.stderr ?? "") + (err.stdout ?? "");
}

function getKlogPath(): string {
  const { klogPath } = getPreferenceValues<KlogPreferences>();
  return klogPath || "klog";
}

function parseNonNegativeNumber(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw?.trim() ?? "");
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function getSkipSessionsShorterThanMinutes(): number {
  const { skipSessionsShorterThanMinutes } = getPreferenceValues<KlogPreferences>();
  return parseNonNegativeNumber(skipSessionsShorterThanMinutes);
}

export function getKlogDir(): string {
  const { klogDir } = getPreferenceValues<KlogPreferences>();
  const dir = klogDir?.trim() ?? "";
  return dir.startsWith("~") ? dir.replace("~", homedir()) : dir;
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
 * Run `klog json <filePath>` and return the raw JSON string.
 */
export async function execKlogJson(filePath: string): Promise<string> {
  return execKlog(["json", filePath]);
}

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

const INDENT_RE = /^(?:\t| {2,4})/;
const TIME_RANGE_RE = /<?(\d{1,2}:\d{2})(am|pm)?>?\s*-\s*<?\d{1,2}:\d{2}(am|pm)?>?\s*(.*)/;

/**
 * Matches a double-indented line (entry summary continuation).
 * Per the klog spec, continuation lines use double indentation.
 */
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
