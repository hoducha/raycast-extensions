import { readdir } from "fs/promises";
import { basename, join } from "path";

import { execKlogJson } from "../klog";
import { KlogProject, KlogProjectData } from "../types";

export async function loadProjects(klogDir: string): Promise<KlogProject[]> {
  let entries;
  try {
    entries = await readdir(klogDir, { withFileTypes: true });
  } catch {
    throw new Error(`Cannot read directory: ${klogDir}. Check the klog Directory preference.`);
  }

  const klgFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".klg")).map((e) => join(klogDir, e.name));

  if (klgFiles.length === 0) return [];

  const results = await Promise.allSettled(
    klgFiles.map(async (filePath) => {
      const json = await execKlogJson(filePath);
      const data: KlogProjectData = JSON.parse(json);
      return { name: basename(filePath, ".klg"), data } satisfies KlogProject;
    }),
  );

  return results.filter((r): r is PromiseFulfilledResult<KlogProject> => r.status === "fulfilled").map((r) => r.value);
}
