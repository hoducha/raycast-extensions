/**
 * Unit tests for todoist/src/helpers/klog.ts
 *
 * Covers the functions added / changed in the PR:
 *   - hasNoSuchRecord()
 *   - removeLastEntry() – full klog-spec entry matching matrix
 *   - hasOpenRangeConflict(), hasNoOpenRange() (regression)
 *   - extractErrorMessage()
 *   - buildKlogSummary(), findMatchingBookmark()
 *   - getSkipSessionsShorterThanMinutes(), getAvoidSilentCloseAfterHours()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-level mocks ───────────────────────────────────────────────────────

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import { readFile, writeFile } from "fs/promises";
import {
  hasNoSuchRecord,
  hasOpenRangeConflict,
  hasNoOpenRange,
  extractErrorMessage,
  buildKlogSummary,
  findMatchingBookmark,
  removeLastEntry,
} from "../helpers/klog";
import { getPreferenceValues } from "@raycast/api";

const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockGetPreferenceValues = getPreferenceValues as ReturnType<typeof vi.fn>;

// Stub out resolveBookmarkPath so removeLastEntry doesn't shell out
vi.mock("../helpers/klog", async (importOriginal) => {
  const original = await importOriginal<typeof import("../helpers/klog")>();
  return {
    ...original,
    resolveBookmarkPath: vi.fn().mockResolvedValue("/tmp/test.klg"),
  };
});

// ── Helper ───────────────────────────────────────────────────────────────────

function makeKlogError(stdout: string, stderr = ""): { stdout: string; stderr: string } {
  return { stdout, stderr };
}

// ── Error predicate tests ─────────────────────────────────────────────────────

describe("hasNoSuchRecord", () => {
  it("returns true when stdout contains 'No such record'", () => {
    expect(hasNoSuchRecord(makeKlogError("Error: No such record\nPlease create or specify a record"))).toBe(true);
  });

  it("returns true when stderr contains 'No such record'", () => {
    expect(hasNoSuchRecord({ stderr: "No such record", stdout: "" })).toBe(true);
  });

  it("returns false for unrelated error", () => {
    expect(hasNoSuchRecord(makeKlogError("Error: Something else"))).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(hasNoSuchRecord({})).toBe(false);
  });
});

describe("hasOpenRangeConflict", () => {
  it("returns true for 'There is already an open range'", () => {
    expect(hasOpenRangeConflict(makeKlogError("There is already an open range"))).toBe(true);
  });

  it("returns false for unrelated message", () => {
    expect(hasOpenRangeConflict(makeKlogError("No such record"))).toBe(false);
  });
});

describe("hasNoOpenRange", () => {
  it("returns true for 'No open time range'", () => {
    expect(hasNoOpenRange(makeKlogError("No open time range"))).toBe(true);
  });

  it("returns false for unrelated message", () => {
    expect(hasNoOpenRange(makeKlogError("No such record"))).toBe(false);
  });
});

// ── extractErrorMessage ───────────────────────────────────────────────────────

describe("extractErrorMessage", () => {
  it("strips 'Error:' prefix and joins multiple lines", () => {
    const err = makeKlogError("Error: Manipulation failed\nThere is already an open range");
    expect(extractErrorMessage(err)).toBe("Manipulation failed – There is already an open range");
  });

  it("falls back to err.message", () => {
    expect(extractErrorMessage({ message: "ENOENT" })).toBe("ENOENT");
  });

  it("returns 'Unknown error' for empty object", () => {
    expect(extractErrorMessage({})).toBe("Unknown error");
  });
});

// ── buildKlogSummary ──────────────────────────────────────────────────────────

describe("buildKlogSummary", () => {
  it("combines task content with lowercased label tags", () => {
    expect(buildKlogSummary("Fix bug", ["coding", "Work"])).toBe("Fix bug #coding #work");
  });

  it("returns only task content when no labels", () => {
    expect(buildKlogSummary("Fix bug", [])).toBe("Fix bug");
  });

  it("handles empty task content with labels", () => {
    expect(buildKlogSummary("", ["coding"])).toBe("#coding");
  });
});

// ── findMatchingBookmark ──────────────────────────────────────────────────────

describe("findMatchingBookmark", () => {
  const bookmarks = ["personal", "work", "freelance"];

  it("matches case-insensitively", () => {
    expect(findMatchingBookmark(bookmarks, "Work")).toBe("work");
  });

  it("returns undefined when no match", () => {
    expect(findMatchingBookmark(bookmarks, "nonexistent")).toBeUndefined();
  });

  it("returns exact match", () => {
    expect(findMatchingBookmark(bookmarks, "personal")).toBe("personal");
  });
});

// ── removeLastEntry ───────────────────────────────────────────────────────────

describe("removeLastEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  function klgFile(lines: string[]): string {
    return lines.join("\n");
  }

  // ── Entry detection matrix ───────────────────────────────────────────────

  const CLOSED_RANGE_EXAMPLES = [
    { label: "4-space indent, standard range", line: "    8:00 - 9:00 task", summary: "task" },
    { label: "tab indent, standard range", line: "\t8:00 - 9:00 task", summary: "task" },
    { label: "2-space indent, standard range", line: "  8:00 - 9:00 task", summary: "task" },
    { label: "AM/PM times", line: "    11:00am - 1:00pm meeting", summary: "meeting" },
    { label: "shift to previous day (<)", line: "    <23:40 - 3:12 late night", summary: "late night" },
    { label: "shift to next day (>)", line: "    0:30> - 4:00> overnight", summary: "overnight" },
    { label: "no summary", line: "    8:00 - 9:00", summary: "" },
  ];

  const NON_RANGE_EXAMPLES = [
    { label: "duration entry", line: "    2h30m coding" },
    { label: "open range", line: "    8:00 - ? working" },
    { label: "record date (not indented)", line: "2024-01-01" },
    { label: "unindented note", line: "Some notes" },
  ];

  for (const { label, line } of CLOSED_RANGE_EXAMPLES) {
    it(`detects and removes: ${label}`, async () => {
      mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "", line, ""]));

      const removed = await removeLastEntry("personal");

      expect(removed).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written: string = mockWriteFile.mock.calls[0][1] as string;
      expect(written).not.toContain(line.trim());
    });
  }

  for (const { label, line } of NON_RANGE_EXAMPLES) {
    it(`does not remove non-range: ${label}`, async () => {
      mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "", line, ""]));

      const removed = await removeLastEntry("personal");

      expect(removed).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  }

  // ── Summary verification ─────────────────────────────────────────────────

  it("removes entry when expectedSummary matches", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 Fix bug #coding", ""]));

    const removed = await removeLastEntry("work", "Fix bug #coding");

    expect(removed).toBe(true);
  });

  it("does NOT remove entry when expectedSummary does not match (race-condition guard)", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 Different task", ""]));

    const removed = await removeLastEntry("work", "Fix bug #coding");

    expect(removed).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("removes entry with no expectedSummary (wildcard)", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 Anything", ""]));

    const removed = await removeLastEntry("work");

    expect(removed).toBe(true);
  });

  // ── Continuation lines ───────────────────────────────────────────────────

  it("removes double-indented continuation lines together with the entry", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 Long task",
      "        continuation one",
      "        continuation two",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    const removed = await removeLastEntry("work");

    expect(removed).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).not.toContain("Long task");
    expect(written).not.toContain("continuation");
  });

  it("does not remove a sibling entry that is not a continuation line", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 First task",
      "    9:05 - 10:00 Second task",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    const removed = await removeLastEntry("work");

    expect(removed).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("8:00 - 9:00 First task");
    expect(written).not.toContain("9:05 - 10:00 Second task");
  });

  // ── Empty / no-range files ───────────────────────────────────────────────

  it("returns false for a file with only duration entries", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    1h30m deep work", ""]));

    expect(await removeLastEntry("work")).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns false for empty file content", async () => {
    mockReadFile.mockResolvedValue("");

    expect(await removeLastEntry("work")).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  // ── Picks the LAST entry ─────────────────────────────────────────────────

  it("targets the last closed range, not the first", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 first",
      "    9:10 - 10:00 second",
      "    10:15 - 11:00 third",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    const removed = await removeLastEntry("work");

    expect(removed).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("8:00 - 9:00 first");
    expect(written).toContain("9:10 - 10:00 second");
    expect(written).not.toContain("10:15 - 11:00 third");
  });
});

// ── Preference parsing ────────────────────────────────────────────────────────

describe("getSkipSessionsShorterThanMinutes", () => {
  it("returns 0 when preference is unset", async () => {
    mockGetPreferenceValues.mockReturnValueOnce({ klogSkipSessionsShorterThanMinutes: undefined });
    const { getSkipSessionsShorterThanMinutes } = await import("../helpers/klog");
    expect(getSkipSessionsShorterThanMinutes()).toBe(0);
  });

  it("parses a positive float", async () => {
    mockGetPreferenceValues.mockReturnValueOnce({ klogSkipSessionsShorterThanMinutes: "3.5" });
    const { getSkipSessionsShorterThanMinutes } = await import("../helpers/klog");
    expect(getSkipSessionsShorterThanMinutes()).toBe(3.5);
  });

  it("returns 0 for a negative value", async () => {
    mockGetPreferenceValues.mockReturnValueOnce({ klogSkipSessionsShorterThanMinutes: "-2" });
    const { getSkipSessionsShorterThanMinutes } = await import("../helpers/klog");
    expect(getSkipSessionsShorterThanMinutes()).toBe(0);
  });
});

describe("getAvoidSilentCloseAfterHours", () => {
  it("returns 0 when preference is unset", async () => {
    mockGetPreferenceValues.mockReturnValueOnce({ klogAvoidSilentCloseAfterHours: undefined });
    const { getAvoidSilentCloseAfterHours } = await import("../helpers/klog");
    expect(getAvoidSilentCloseAfterHours()).toBe(0);
  });

  it("parses a valid hour value", async () => {
    mockGetPreferenceValues.mockReturnValueOnce({ klogAvoidSilentCloseAfterHours: "24" });
    const { getAvoidSilentCloseAfterHours } = await import("../helpers/klog");
    expect(getAvoidSilentCloseAfterHours()).toBe(24);
  });
});
