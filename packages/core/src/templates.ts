import { homedir } from "node:os";
import path from "node:path";

export const TEMPLATE_LIVE_FILES = ["AGENTS.md", "RULES.md"] as const;
export type TemplateLiveFile = (typeof TEMPLATE_LIVE_FILES)[number];

export const TEMPLATE_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export function isValidTemplateName(name: string): boolean {
  return TEMPLATE_NAME_PATTERN.test(name);
}

export function templateFileName(liveFile: TemplateLiveFile): string {
  return liveFile.replace(/\.md$/, ".template.md");
}

export function resolveTemplatesDir(checkoutRoot: string): string {
  return path.join(checkoutRoot, "templates");
}

export function resolveCheckoutCandidates(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  home: string = homedir(),
): string[] {
  const candidates: string[] = [];

  const envHome = env.OMP_TOOLKIT_HOME?.trim();
  if (envHome) {
    candidates.push(envHome);
  }

  // Walk up cwd directory hierarchy nearest-first
  if (cwd && cwd.trim().length > 0) {
    let current = path.resolve(cwd);
    while (true) {
      candidates.push(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  // Fallback deployed clone under home
  candidates.push(path.join(home, ".omp", "omp-toolkit"));

  // De-duplicate while preserving first appearance order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(normalized);
    }
  }

  return deduped;
}

export function checkoutProbePath(candidate: string): string {
  return path.join(candidate, "scripts", "monitor", "orca-monitor.ts");
}

export type TemplateContents = Partial<Record<TemplateLiveFile, string>>;

export interface TemplateFileComparison {
  file: TemplateLiveFile;
  inTemplate: boolean;
  liveExists: boolean;
  identical: boolean;
}

export function compareTemplateToLive(
  template: TemplateContents,
  live: TemplateContents,
): TemplateFileComparison[] {
  return TEMPLATE_LIVE_FILES.map((file) => {
    const inTemplate = Object.hasOwn(template, file) && template[file] !== undefined;
    const liveExists = Object.hasOwn(live, file) && live[file] !== undefined;
    let identical = false;
    if (!inTemplate && !liveExists) {
      identical = true;
    } else if (inTemplate && liveExists) {
      identical = template[file] === live[file];
    }
    return {
      file,
      inTemplate,
      liveExists,
      identical,
    };
  });
}

export function templateMatchesLive(template: TemplateContents, live: TemplateContents): boolean {
  const comparisons = compareTemplateToLive(template, live);
  return comparisons.every((c) => c.identical);
}
