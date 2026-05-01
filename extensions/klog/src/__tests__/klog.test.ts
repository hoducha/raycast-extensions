/**
 * Unit tests for klog/src/klog.ts
 *
 * Covers the functions added / changed in the PR:
 *   - hasNoSuchRecord()
 *   - removeLastEntry() – full klog-spec entry matching matrix
 *   - hasOpenRangeConflict(), hasNoOpenRange() (regression)
 *   - extractErrorMessage()
 *   - normalizeBookmark(), normalizeTags(), buildSummary()
 *   - getSkipSessionsShorterThanMinutes()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module-level mocks (must be called before any imports of the module) ─────

// fs/promises – prevent any actual disk access
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// child_process – prevent shell out; exec is only used by openWithEditor (not tested here)
vi.mock("child_process", () => ({ exec: vi.fn() }));

// util – promisify wraps exec → return a factory that produces a controllable spy
vi.mock("util", async () => {
  const execSpy = vi.fn().mockResolvedValue({ stdout: "/tmp/test.klg", stderr: "" });
  return { promisify: () => execSpy };
});

// os – homedir used only by getKlogDir, not exercised in these tests
vi.mock("os", () => ({ homedir: () => "/Users/test" }));

import { readFile, writeFile } from "fs/promises";
import {
  hasNoSuchRecord,
  hasOpenRangeConflict,
  hasNoOpenRange,
  extractErrorMessage,
  normalizeBookmark,
  normalizeTags,
  buildSummary,
  removeLastEntry,
  getSkipSessionsShorterThanMinutes,
} from "../klog";
import { getPreferenceValues } from "@raycast/api";

const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockGetPreferenceValues = getPreferenceValues as ReturnType<typeof vi.fn>;

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

  it("returns false for an unrelated error", () => {
    expect(hasNoSuchRecord(makeKlogError("Error: Something else went wrong"))).toBe(false);
  });

  it("returns false for empty error object", () => {
    expect(hasNoSuchRecord({})).toBe(false);
  });
});

describe("hasOpenRangeConflict", () => {
  it("returns true when output contains 'There is already an open range'", () => {
    expect(hasOpenRangeConflict(makeKlogError("Error: There is already an open range"))).toBe(true);
  });

  it("returns false for unrelated message", () => {
    expect(hasOpenRangeConflict(makeKlogError("Unknown error"))).toBe(false);
  });
});

describe("hasNoOpenRange", () => {
  it("returns true when output contains 'No open time range'", () => {
    expect(hasNoOpenRange(makeKlogError("No open time range"))).toBe(true);
  });

  it("returns false for unrelated message", () => {
    expect(hasNoOpenRange(makeKlogError("Something else"))).toBe(false);
  });
});

// ── extractErrorMessage tests ─────────────────────────────────────────────────

describe("extractErrorMessage", () => {
  it("strips 'Error:' prefix and joins multi-line klog output", () => {
    const err = makeKlogError("Error: Manipulation failed\nThere is already an open range");
    expect(extractErrorMessage(err)).toBe("Manipulation failed – There is already an open range");
  });

  it("falls back to err.message when stdout and stderr are empty", () => {
    expect(extractErrorMessage({ message: "ENOENT" })).toBe("ENOENT");
  });

  it("returns 'Unknown error' when no useful information is available", () => {
    expect(extractErrorMessage({})).toBe("Unknown error");
  });

  it("prefers stderr (trimmed) over stdout when both are present", () => {
    const err = { stderr: "Error: stderr message", stdout: "stdout message" };
    expect(extractErrorMessage(err)).toBe("stderr message");
  });
});

// ── normalizeBookmark / normalizeTags / buildSummary tests ───────────────────

describe("normalizeBookmark", () => {
  it("strips leading @", () => expect(normalizeBookmark("@personal")).toBe("personal"));
  it("lowercases the bookmark name", () => expect(normalizeBookmark("@Personal")).toBe("personal"));
  it("handles bookmark without @ prefix", () => expect(normalizeBookmark("Work")).toBe("work"));
  it("trims trailing whitespace", () => expect(normalizeBookmark("@home   ")).toBe("home"));
  it("normalizes when there is no leading space (the common case)", () => expect(normalizeBookmark("@Work")).toBe("work"));

});

describe("normalizeTags", () => {
  it("returns empty array for blank string", () => {
    expect(normalizeTags("")).toEqual([]);
    expect(normalizeTags("   ")).toEqual([]);
  });

  it("normalizes tags with # prefix", () => {
    expect(normalizeTags("#coding #Work")).toEqual(["#coding", "#work"]);
  });

  it("normalizes tags without # prefix", () => {
    expect(normalizeTags("coding Work")).toEqual(["#coding", "#work"]);
  });

  it("handles mixed # and non-# tags", () => {
    expect(normalizeTags("coding #Work")).toEqual(["#coding", "#work"]);
  });
});

describe("buildSummary", () => {
  it("combines task name and tags", () => {
    expect(buildSummary("My task", ["#coding", "#work"])).toBe("My task #coding #work");
  });

  it("returns just the task name when there are no tags", () => {
    expect(buildSummary("My task", [])).toBe("My task");
  });
});

// ── removeLastEntry tests ─────────────────────────────────────────────────────

describe("removeLastEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  function klgFile(lines: string[]): string {
    return lines.join("\n");
  }

  // ── Entry detection matrix (klog v1.4 spec) ──────────────────────────────

  const CLOSED_RANGE_EXAMPLES = [
    { label: "4-space indent, standard range", line: "    8:00 - 9:00 task" },
    { label: "tab indent, standard range", line: "\t8:00 - 9:00 task" },
    { label: "2-space indent, standard range", line: "  8:00 - 9:00 task" },
    { label: "AM/PM times", line: "    11:00am - 1:00pm meeting" },
    { label: "shift to previous day (<)", line: "    <23:40 - 3:12 late night" },
    { label: "shift to next day (>)", line: "    0:30> - 4:00> overnight" },
    { label: "no summary", line: "    8:00 - 9:00" },
  ];

  const NON_RANGE_EXAMPLES = [
    { label: "duration entry", line: "    2h30m coding" },
    { label: "open range (ends with ?)", line: "    8:00 - ? working" },
    { label: "record date (not indented)", line: "2024-01-01" },
    { label: "record summary (not indented)", line: "Some notes about the day" },
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
    it(`does not remove non-range line: ${label}`, async () => {
      mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "", line, ""]));

      const removed = await removeLastEntry("personal");

      expect(removed).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  }

  // ── Summary verification ─────────────────────────────────────────────────

  it("removes the entry when expectedSummary matches", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 My task #coding", ""]));

    const removed = await removeLastEntry("personal", "My task #coding");

    expect(removed).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it("does NOT remove the entry when expectedSummary does not match (race-condition guard)", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 Different task #work", ""]));

    const removed = await removeLastEntry("personal", "My task #coding");

    expect(removed).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("removes the entry when no expectedSummary is given (wildcard)", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "    8:00 - 9:00 Any task", ""]));

    expect(await removeLastEntry("personal")).toBe(true);
  });

  // ── Continuation lines ───────────────────────────────────────────────────

  it("removes double-indented continuation lines together with the entry", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 Long task",
      "        This is continuation line one",
      "        Second continuation line",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    expect(await removeLastEntry("personal")).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).not.toContain("Long task");
    expect(written).not.toContain("continuation");
  });

  it("stops at the first non-double-indented sibling line", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 Task with note",
      "        note line",
      "    10:00 - 11:00 Next task",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    // The LAST closed range is "10:00 - 11:00 Next task"
    expect(await removeLastEntry("personal")).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("8:00 - 9:00 Task with note");
    expect(written).not.toContain("10:00 - 11:00 Next task");
  });

  // ── Empty / no-entry files ───────────────────────────────────────────────

  it("returns false when the file has no closed time range entries", async () => {
    mockReadFile.mockResolvedValue(klgFile(["2024-01-01", "Some summary", "    1h30m deep work", ""]));

    expect(await removeLastEntry("personal")).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns false for an empty file", async () => {
    mockReadFile.mockResolvedValue("");

    expect(await removeLastEntry("personal")).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  // ── Picks the LAST entry ─────────────────────────────────────────────────

  it("removes the last entry when multiple closed ranges exist", async () => {
    const content = klgFile([
      "2024-01-01",
      "    8:00 - 9:00 first task",
      "    9:05 - 10:00 second task",
      "    10:10 - 11:00 third task",
      "",
    ]);
    mockReadFile.mockResolvedValue(content);

    expect(await removeLastEntry("personal")).toBe(true);
    const written: string = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("8:00 - 9:00 first task");
    expect(written).toContain("9:05 - 10:00 second task");
    expect(written).not.toContain("10:10 - 11:00 third task");
  });
});

// ── getSkipSessionsShorterThanMinutes (preference parsing) ───────────────────

describe("getSkipSessionsShorterThanMinutes", () => {
  it("returns 0 when preference is undefined", () => {
    mockGetPreferenceValues.mockReturnValue({ skipSessionsShorterThanMinutes: undefined });
    expect(getSkipSessionsShorterThanMinutes()).toBe(0);
  });

  it("parses a valid positive float", () => {
    mockGetPreferenceValues.mockReturnValue({ skipSessionsShorterThanMinutes: "2.5" });
    expect(getSkipSessionsShorterThanMinutes()).toBe(2.5);
  });

  it("returns 0 for a negative value", () => {
    mockGetPreferenceValues.mockReturnValue({ skipSessionsShorterThanMinutes: "-1" });
    expect(getSkipSessionsShorterThanMinutes()).toBe(0);
  });

  it("returns 0 for a non-numeric string", () => {
    mockGetPreferenceValues.mockReturnValue({ skipSessionsShorterThanMinutes: "abc" });
    expect(getSkipSessionsShorterThanMinutes()).toBe(0);
  });
});
