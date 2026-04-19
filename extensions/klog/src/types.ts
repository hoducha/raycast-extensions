export interface KlogEntry {
  summary: string;
  total: string;
  total_mins: number;
  tags: string[] | null;
}

export interface KlogRecord {
  date: string;
  entries: KlogEntry[];
  total_mins: number;
}

export interface KlogProjectData {
  records: KlogRecord[];
}

export interface KlogProject {
  name: string;
  data: KlogProjectData;
}
