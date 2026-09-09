/**
 * Project intelligence model. Persistent structured metadata about a
 * repository handled by AgentOS — never the repository contents themselves.
 * The scanner in `@agentos/runtime` produces these records; the control plane
 * persists them under `/projects`.
 */

export interface ProjectIntelligence {
  languages: string[];
  framework: string | null;
  packageManager: string | null;
  dependencies: string[];
  scripts: Record<string, string>;
  database: string | null;
  architecture: string[];
  importantFiles: string[];
  envRequirements: string[];
  git: {
    appType: 'app' | 'library' | 'unknown';
    hasGit: boolean;
  };
  detectedAt: string | null;
}

export type ProjectStatus = 'pending' | 'scanning' | 'indexed' | 'failed';

export const PROJECT_STATUSES = ['pending', 'scanning', 'indexed', 'failed'] as const satisfies readonly ProjectStatus[];

export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  path: string | null;
  repository_url: string | null;
  status: ProjectStatus;
  intelligence: ProjectIntelligence | null;
  created_at: string;
  updated_at: string;
}