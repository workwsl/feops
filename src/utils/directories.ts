import * as fs from 'fs';
import * as path from 'path';
import { Config, GitLabGroup } from '../config';

export interface GitProject {
  name: string;
  path: string;
  groupPath?: string;
}

/**
 * 解析 group 的本地根目录（由 group.path 推导）
 * - 绝对 path → resolve(path)
 * - 相对 path → resolve(directoryOverride ?? defaults.directory, path)
 */
export function resolveGroupDirectory(
  group: GitLabGroup,
  defaults: Config['defaults'],
  directoryOverride?: string
): string {
  if (path.isAbsolute(group.path)) {
    return path.resolve(group.path);
  }
  const base = directoryOverride ?? defaults.directory;
  return path.resolve(base, group.path);
}

/**
 * 解析单个 repo 的本地路径
 */
export function resolveRepoLocalPath(
  group: GitLabGroup,
  repoRelativePath: string,
  defaults: Config['defaults'],
  directoryOverride?: string
): string {
  const groupDir = resolveGroupDirectory(group, defaults, directoryOverride);
  return path.join(groupDir, repoRelativePath);
}

/**
 * 获取所有需要扫描/写入的 group 目录（去重）
 */
export function getAllGroupDirectories(
  config: Config,
  options?: { groupPath?: string; directoryOverride?: string }
): string[] {
  let groups = config.gitlab.groups;

  if (options?.groupPath) {
    groups = groups.filter(g => g.path === options.groupPath);
    if (groups.length === 0) {
      throw new Error(`Group "${options.groupPath}" 未在配置中找到`);
    }
  }

  const directories = groups.map(group => {
    const override = options?.directoryOverride;
    return resolveGroupDirectory(group, config.defaults, override);
  });

  return [...new Set(directories)];
}

/**
 * 根据 CLI 选项解析要扫描的目录列表
 */
export function resolveScanDirectories(
  config: Config,
  options?: { directory?: string; group?: string }
): string[] {
  if (options?.directory) {
    return [path.resolve(options.directory)];
  }

  if (options?.group) {
    return getAllGroupDirectories(config, { groupPath: options.group });
  }

  return getAllGroupDirectories(config);
}

/**
 * 扫描目录下的 Git 项目
 */
export function scanGitProjectsInDirectory(dir: string, groupPath?: string): GitProject[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const projects: GitProject[] = [];

  const scanDirectory = (currentDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // 不跟随符号链接，避免循环或扫描 group 目录外的仓库。
      if (entry.name === '.git' || entry.isSymbolicLink() || !entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(currentDir, entry.name);
      if (fs.existsSync(path.join(entryPath, '.git'))) {
        const project: GitProject = {
          name: entry.name,
          path: entryPath
        };
        if (groupPath) {
          project.groupPath = groupPath;
        }
        projects.push(project);
        // 已进入 Git 仓库根目录，不递归扫描其内部目录。
        continue;
      }

      scanDirectory(entryPath);
    }
  };

  scanDirectory(dir);
  return projects;
}

/**
 * 扫描所有 group 目录下的 Git 项目
 */
export function scanAllGitProjects(
  config: Config,
  options?: { directory?: string; group?: string }
): GitProject[] {
  const groups = options?.group
    ? config.gitlab.groups.filter(g => g.path === options.group)
    : config.gitlab.groups;

  if (options?.directory) {
    return scanGitProjectsInDirectory(path.resolve(options.directory));
  }

  const projects: GitProject[] = [];
  const seenPaths = new Set<string>();

  for (const group of groups) {
    const dir = resolveGroupDirectory(group, config.defaults);
    for (const project of scanGitProjectsInDirectory(dir, group.path)) {
      if (!seenPaths.has(project.path)) {
        seenPaths.add(project.path);
        projects.push(project);
      }
    }
  }

  return projects;
}

/**
 * 根据 group_path 查找 group 配置
 */
export function findGroupByPath(config: Config, groupPath: string): GitLabGroup | undefined {
  return config.gitlab.groups.find(g => g.path === groupPath);
}
