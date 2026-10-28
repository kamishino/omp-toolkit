import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareTemplateToLive,
  isValidTemplateName,
  resolveCheckoutCandidates,
  TEMPLATE_LIVE_FILES,
  type TemplateContents,
  type TemplateFileComparison,
  type TemplateLiveFile,
  templateFileName,
  templateMatchesLive,
} from "@omp-toolkit/core";
import { short, writeFileAtomic } from "./fs-util";

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function assertValidName(name: string): void {
  if (!isValidTemplateName(name)) {
    throw new Error(
      `invalid template name "${name}": use 1-64 chars of [a-z0-9-_], starting with a letter or digit`,
    );
  }
}

export function resolveCheckoutRoot(
  env = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): string {
  const envOverride = env.OMP_TOOLKIT_HOME?.trim();
  if (envOverride && envOverride.length > 0) {
    const probe = path.join(envOverride, "scripts", "monitor", "orca-monitor.ts");
    if (!isRegularFile(probe)) {
      throw new Error(`OMP_TOOLKIT_HOME is not an omp-toolkit checkout: ${envOverride}`);
    }
    return path.resolve(envOverride);
  }

  const candidates = resolveCheckoutCandidates(env, cwd, home);
  for (const candidate of candidates) {
    const probe = path.join(candidate, "scripts", "monitor", "orca-monitor.ts");
    if (isRegularFile(probe)) {
      return path.resolve(candidate);
    }
  }

  throw new Error(
    "omp-toolkit checkout not found; set OMP_TOOLKIT_HOME to your omp-toolkit checkout",
  );
}

export function readLiveContents(agentDirPath: string): TemplateContents {
  const contents: TemplateContents = {};
  for (const file of TEMPLATE_LIVE_FILES) {
    const filePath = path.join(agentDirPath, file);
    if (isRegularFile(filePath)) {
      contents[file] = fs.readFileSync(filePath, "utf8");
    }
  }
  return contents;
}

export function readTemplateContents(templateDir: string): TemplateContents {
  const contents: TemplateContents = {};
  for (const file of TEMPLATE_LIVE_FILES) {
    const filePath = path.join(templateDir, templateFileName(file));
    if (isRegularFile(filePath)) {
      contents[file] = fs.readFileSync(filePath, "utf8");
    }
  }
  return contents;
}

export interface SaveResult {
  name: string;
  dir: string;
  files: TemplateLiveFile[];
}

export function saveTemplate(
  templatesDir: string,
  agentDirPath: string,
  name: string,
  options: { force: boolean },
): SaveResult {
  assertValidName(name);

  const live = readLiveContents(agentDirPath);
  const presentFiles = TEMPLATE_LIVE_FILES.filter(
    (file) => Object.hasOwn(live, file) && live[file] !== undefined,
  );

  if (presentFiles.length === 0) {
    throw new Error(`nothing to save: neither AGENTS.md nor RULES.md exists in ${agentDirPath}`);
  }

  const targetDir = path.join(templatesDir, name);
  if (fs.existsSync(targetDir) && !options.force) {
    throw new Error(`template "${name}" already exists; pass --force to overwrite`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of presentFiles) {
    const content = live[file];
    if (content !== undefined) {
      const targetFile = path.join(targetDir, templateFileName(file));
      writeFileAtomic(targetFile, content);
    }
  }

  // Ensure exact mirror: remove any template file for a live file that was absent
  for (const file of TEMPLATE_LIVE_FILES) {
    if (!presentFiles.includes(file)) {
      fs.rmSync(path.join(targetDir, templateFileName(file)), { force: true });
    }
  }

  return {
    name,
    dir: targetDir,
    files: presentFiles,
  };
}

export interface ApplyResult {
  name: string;
  backupDir: string | null;
  written: TemplateLiveFile[];
  deleted: TemplateLiveFile[];
  unchanged: TemplateLiveFile[];
}

export function applyTemplate(
  templatesDir: string,
  agentDirPath: string,
  name: string,
  now: Date = new Date(),
): ApplyResult {
  assertValidName(name);

  const targetDir = path.join(templatesDir, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`template "${name}" not found in ${templatesDir}`);
  }

  const template = readTemplateContents(targetDir);
  const knownInTemplate = TEMPLATE_LIVE_FILES.filter(
    (file) => Object.hasOwn(template, file) && template[file] !== undefined,
  );

  if (knownInTemplate.length === 0) {
    throw new Error(`template "${name}" contains neither AGENTS.template.md nor RULES.template.md`);
  }

  const liveSnapshot = readLiveContents(agentDirPath);
  const livePresentFiles = TEMPLATE_LIVE_FILES.filter(
    (file) => Object.hasOwn(liveSnapshot, file) && liveSnapshot[file] !== undefined,
  );

  let backupDir: string | null = null;
  if (livePresentFiles.length > 0) {
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    backupDir = path.join(agentDirPath, "backups", timestamp);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const file of livePresentFiles) {
      fs.copyFileSync(path.join(agentDirPath, file), path.join(backupDir, file));
    }
  }

  const written: TemplateLiveFile[] = [];
  const deleted: TemplateLiveFile[] = [];
  const unchanged: TemplateLiveFile[] = [];

  try {
    for (const file of TEMPLATE_LIVE_FILES) {
      const inTemplate = Object.hasOwn(template, file) && template[file] !== undefined;
      const inLive = Object.hasOwn(liveSnapshot, file) && liveSnapshot[file] !== undefined;
      const livePath = path.join(agentDirPath, file);

      if (!inTemplate && !inLive) {
        unchanged.push(file);
      } else if (inTemplate && inLive && template[file] === liveSnapshot[file]) {
        unchanged.push(file);
      } else if (inTemplate) {
        const content = template[file];
        if (content !== undefined) {
          writeFileAtomic(livePath, content);
          written.push(file);
        }
      } else if (inLive) {
        fs.rmSync(livePath, { force: true });
        deleted.push(file);
      }
    }
  } catch (err) {
    try {
      for (const file of TEMPLATE_LIVE_FILES) {
        const livePath = path.join(agentDirPath, file);
        const prevContent = liveSnapshot[file];
        if (Object.hasOwn(liveSnapshot, file) && prevContent !== undefined) {
          writeFileAtomic(livePath, prevContent);
        } else {
          fs.rmSync(livePath, { force: true });
        }
      }
      throw new Error(
        `apply failed (${short(err)}); live files restored from pre-apply snapshot; backup: ${backupDir ?? "none"}`,
      );
    } catch (rollbackErr) {
      if (rollbackErr instanceof Error && rollbackErr.message.startsWith("apply failed (")) {
        throw rollbackErr;
      }
      throw new Error(
        `apply failed (${short(err)}); rollback failed (${short(rollbackErr)}); restore manually from ${backupDir ?? "none"}`,
      );
    }
  }

  return {
    name,
    backupDir,
    written,
    deleted,
    unchanged,
  };
}

export interface TemplateSummary {
  name: string;
  files: TemplateLiveFile[];
  modifiedAtMs: number;
  matchesLive: boolean;
}

export function listTemplates(templatesDir: string, agentDirPath: string): TemplateSummary[] {
  if (!fs.existsSync(templatesDir)) {
    return [];
  }

  const live = readLiveContents(agentDirPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(templatesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: TemplateSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidTemplateName(entry.name)) {
      continue;
    }

    const templateDir = path.join(templatesDir, entry.name);
    const template = readTemplateContents(templateDir);
    const files = TEMPLATE_LIVE_FILES.filter(
      (file) => Object.hasOwn(template, file) && template[file] !== undefined,
    );

    if (files.length === 0) {
      continue;
    }

    let modifiedAtMs = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(templateDir, templateFileName(file)));
        if (stat.mtimeMs > modifiedAtMs) {
          modifiedAtMs = stat.mtimeMs;
        }
      } catch {
        // Ignore stat failure
      }
    }

    summaries.push({
      name: entry.name,
      files,
      modifiedAtMs,
      matchesLive: templateMatchesLive(template, live),
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

export interface ShowResult {
  name: string;
  dir: string;
  comparisons: TemplateFileComparison[];
  matchesLive: boolean;
}

export function showTemplate(templatesDir: string, agentDirPath: string, name: string): ShowResult {
  assertValidName(name);

  const targetDir = path.join(templatesDir, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`template "${name}" not found in ${templatesDir}`);
  }

  const template = readTemplateContents(targetDir);
  const knownFiles = TEMPLATE_LIVE_FILES.filter(
    (file) => Object.hasOwn(template, file) && template[file] !== undefined,
  );

  if (knownFiles.length === 0) {
    throw new Error(`template "${name}" contains neither AGENTS.template.md nor RULES.template.md`);
  }

  const live = readLiveContents(agentDirPath);
  const comparisons = compareTemplateToLive(template, live);
  const matchesLive = templateMatchesLive(template, live);

  return {
    name,
    dir: targetDir,
    comparisons,
    matchesLive,
  };
}

export function deleteTemplate(
  templatesDir: string,
  name: string,
  options: { force: boolean },
): void {
  assertValidName(name);

  if (!options.force) {
    throw new Error(`pass --force to delete template "${name}"`);
  }

  const targetDir = path.join(templatesDir, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`template "${name}" not found in ${templatesDir}`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
}
