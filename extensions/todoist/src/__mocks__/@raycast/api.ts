/**
 * Minimal @raycast/api stub for unit tests.
 * Only the symbols consumed by todoist/src/helpers/klog.ts are defined here.
 */
import { vi } from "vitest";

export const getPreferenceValues = vi.fn(() => ({
  klogPath: "/usr/local/bin/klog",
  klogAvoidSilentCloseAfterHours: "0",
  klogSkipSessionsShorterThanMinutes: "0",
}));
