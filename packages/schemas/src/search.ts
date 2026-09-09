import { z } from 'zod';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const webSearchArgsSchema = z.object({
  query: z.string().min(3).max(300)
});

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string()
});

export const searchResultsSchema = z.array(searchResultSchema);