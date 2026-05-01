/**
 * Minimal @raycast/api stub for unit tests.
 * Only the symbols consumed by klog.ts are defined here.
 */
export const getPreferenceValues = vi.fn(() => ({
  klogPath: "klog",
  klogDir: "",
  editorApp: "",
  skipSessionsShorterThanMinutes: "0",
}));

// Make vi available globally in this stub (vitest injects it)
import { vi } from "vitest";
