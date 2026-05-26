import * as fs from 'fs';
import * as path from 'path';
import { Config, GitLabGroup } from '../config';

export interface GitProject {
  name: string;
  path: string;
  groupPath?: string;
}

/**
 * 解析 group 的本地根目录
 * - 配置了 directory → resolve(directory)
 * - 未配置（旧配置）→ resolve(defaults.directory)
 */
export function resolveGroupDirectory(
  group: GitLabGroup,
  defaults: Config['defaults'],
  directoryOverride?: string
): string {
  if (group.directory !== undefined) {
    return path.resolve(group.directory);
  }
  return path.resolve(directoryOverride ?? defaults.directory);
}

/**
 * 解析单个 repo 的本地路径
 */
export function resolveRepoLocalPath(
  group: GitLabGroup,
  repoName: string,
  defaults: Config['defaults'],
  directoryOverride?: string
): string {
  const groupDir = resolveGroupDirectory(group, defaults, directoryOverride);
  return path.join(groupDir, repoName);
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

  return fs.readdirSync(dir)
    .filter(item => {
      const itemPath = path.join(dir, item);
      return fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, '.git'));
    })
    .map(name => {
      const project: GitProject = {
        name,
        path: path.join(dir, name)
      };
      if (groupPath) {
        project.groupPath = groupPath;
      }
      return project;
    });
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
