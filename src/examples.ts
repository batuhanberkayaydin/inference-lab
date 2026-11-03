import { api } from "./api";

export type PromptExample = {
  id: string;
  name: string;
  filename: string;
  category: string;
  target_tokens: number;
  characters: number;
  sha256: string;
};

export const loadExample = (id: string) =>
  api<PromptExample & { content: string }>(`/examples/${encodeURIComponent(id)}`);
