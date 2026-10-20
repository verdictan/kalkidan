export interface ProjectMemory {
  pages: { name: string; content: string; updatedAt: string; truncated: boolean }[];
  limited: boolean;
}
