import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import Table from 'cli-table3';
import { loadConfig, loadBlacklist, configExists } from '../config';
import { GitLabService } from '../services/gitlab';
import { findGroupByPath, resolveRepoLocalPath, getAllGroupDirectories } from '../utils/directories';

interface CloneOrUpdateResult {
  name: string;
  groupPath?: string;
  action: 'cloned' | 'updated' | 'skipped' | 'error';
  success: boolean;
  error?: string;
  duration: number;
  path: string;
  branch?: string;
}

interface CloneOrUpdateOptions {
  directory?: string;
  blacklist: string[];
  dryRun: boolean;
  parallel?: number;
  gitUrlBase?: string;
  branch?: string;
}

export const syncCommand = new Command('sync')
  .description('从 GitLab API 批量克隆或更新前端仓库')
  .option('-d, --directory <dir>', '克隆目标目录（仅覆盖未配置 group.directory 的旧 group）')
  .option('-g, --group <path>', '仅同步指定的 GitLab Group')
  .option('-b, --blacklist <repos...>', '临时黑名单仓库列表，多个仓库用空格分隔', [])
  .option('--dry-run', '预览模式，不实际执行克隆或更新操作')
  .option('-p, --parallel <number>', '并发处理数量（覆盖配置文件中的默认值）')
  .option('--git-url-base <url>', 'Git URL 基础地址（覆盖配置文件中的 GitLab URL）')
  .option('--branch <branch>', '默认分支名称（覆盖配置文件中的默认值）')
  .action(async (options) => {
    console.log(chalk.cyan('🚀 前端仓库批量克隆或更新工具'));
    
    // 检查配置文件是否存在
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }
    
    try {
      // 加载配置
      const config = loadConfig();
      
      // 合并命令行选项和配置文件
      const directoryOverride = options.directory as string | undefined;
      const parallel = options.parallel ? parseInt(options.parallel) : config.defaults.parallel;
      const gitUrlBase = options.gitUrlBase || config.gitlab.url;
      const branch = options.branch || config.defaults.branch;
      
      // 加载黑名单
      const configBlacklist = loadBlacklist();
      const cmdBlacklist = options.blacklist || [];
      const blacklist = [...new Set([...configBlacklist, ...cmdBlacklist])];
      
      console.log(chalk.gray(`从 GitLab API 获取仓库列表...`));
      
      // 从 GitLab API 获取仓库列表
      const gitlabService = GitLabService.fromConfig();
      const groupProjects = await gitlabService.fetchProjectsByGroup(options.group);
      const repositories = groupProjects.flatMap(item => item.repos);
      
      console.log(chalk.gray(`找到 ${repositories.length} 个仓库`));
      
      // 过滤掉黑名单和已归档的仓库
      const filteredRepos = repositories.filter(repo => {
        if (repo.archived) {
          console.log(chalk.yellow(`⏭️  跳过已归档仓库: ${repo.name} (${repo.group_path})`));
          return false;
        }
        
        if (blacklist.includes(repo.name)) {
          console.log(chalk.yellow(`⏭️  跳过黑名单仓库: ${repo.name} (${repo.group_path})`));
          return false;
        }
        
        return true;
      });
      
      console.log(chalk.gray(`过滤后剩余: ${filteredRepos.length} 个仓库`));
      
      if (filteredRepos.length === 0) {
        console.log(chalk.yellow('没有需要处理的仓库'));
        return;
      }
      
      // 生成仓库信息
      const repoInfos = filteredRepos.map(repo => {
        const group = findGroupByPath(config, repo.group_path);
        if (!group) {
          throw new Error(`未找到 Group 配置: ${repo.group_path}`);
        }

        const gitUrl = `${gitUrlBase}${repo.relative_path}.git`;
        const localPath = resolveRepoLocalPath(group, repo.name, config.defaults, directoryOverride);
        
        return {
          ...repo,
          gitUrl,
          localPath,
          exists: fs.existsSync(localPath),
          isGitRepo: fs.existsSync(localPath) ? isGitRepository(localPath) : false
        };
      });
      
      // 预览模式
      if (options.dryRun) {
        console.log(chalk.cyan('\n🔍 预览模式 - 将要执行的操作:'));
        repoInfos.forEach((repo, index) => {
          let action = '';
          if (!repo.exists) {
            action = chalk.green('克隆');
          } else if (repo.isGitRepo) {
            action = chalk.blue('更新');
          } else {
            action = chalk.red('错误: 目录存在但不是Git仓库');
          }
          
          console.log(chalk.gray(`  ${index + 1}. [${repo.group_path}] ${repo.name} - ${action}`));
          console.log(chalk.gray(`     URL: ${repo.gitUrl}`));
          console.log(chalk.gray(`     路径: ${repo.localPath}`));
        });
        return;
      }
      
      // 确保所有 group 目录存在
      const groupDirOptions = options.group
        ? { groupPath: options.group as string }
        : undefined;
      const groupDirectories = directoryOverride
        ? getAllGroupDirectories(config, { ...groupDirOptions, directoryOverride })
        : getAllGroupDirectories(config, groupDirOptions);
      for (const groupDir of groupDirectories) {
        if (!fs.existsSync(groupDir)) {
          fs.mkdirSync(groupDir, { recursive: true });
          console.log(chalk.green(`✅ 创建目录: ${groupDir}`));
        }
      }
      
      // 执行克隆或更新操作
      const results: CloneOrUpdateResult[] = [];
      await processRepositoriesInParallel(repoInfos, parallel, { branch } as CloneOrUpdateOptions, results);
      
      // 显示结果统计
      showResults(results);
      
    } catch (error) {
      console.error(chalk.red('❌ 执行失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * 检查目录是否为 Git 仓库
 */
function isGitRepository(dirPath: string): boolean {
  const gitDir = path.join(dirPath, '.git');
  return fs.existsSync(gitDir);
}

/**
 * 检查仓库是否有未提交的更改
 */
async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  try {
    // 检查工作区是否有未提交的更改
    const statusResult = await executeGitCommandWithOutput(['status', '--porcelain'], repoPath);
    return statusResult.trim().length > 0;
  } catch (error) {
    // 如果命令执行失败，假设有未提交的更改，避免误操作
    return true;
  }
}

/**
 * 获取当前分支名
 */
async function getCurrentBranch(repoPath: string): Promise<string> {
  try {
    const branchResult = await executeGitCommandWithOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    return branchResult.trim();
  } catch (error) {
    return 'unknown';
  }
}

/**
 * 执行 Git 命令并返回输出
 */
function executeGitCommandWithOutput(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd: cwd || process.cwd(),
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    git.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    git.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: ${args.join(' ')}\n${stderr}`));
      }
    });
    
    git.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * 并发处理仓库
 */
async function processRepositoriesInParallel(
  repositories: any[],
  parallel: number,
  options: CloneOrUpdateOptions,
  results: CloneOrUpdateResult[]
): Promise<void> {
  const chunks = [];
  for (let i = 0; i < repositories.length; i += parallel) {
    chunks.push(repositories.slice(i, i + parallel));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(repo => processRepository(repo, options));
    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
    
    // 显示进度
    console.log(chalk.gray(`已处理: ${results.length}/${repositories.length}`));
  }
}

/**
 * 处理单个仓库（克隆或更新）
 */
async function processRepository(repo: any, options: CloneOrUpdateOptions): Promise<CloneOrUpdateResult> {
  const startTime = Date.now();
  
  try {
    if (!repo.exists) {
      // 克隆新仓库
      console.log(chalk.blue(`🔄 克隆仓库: ${repo.name}`));
      await executeGitCommand(['clone', repo.gitUrl, repo.localPath]);
      
      const duration = Date.now() - startTime;
      console.log(chalk.green(`✅ 克隆成功: ${repo.name} (${duration}ms)`));
      
      return {
        name: repo.name,
        action: 'cloned',
        success: true,
        duration,
        path: repo.localPath
      };
      
    } else if (repo.isGitRepo) {
      // 更新已存在的仓库
      const targetBranch = options.branch || 'master';
      
      // 检查是否有未提交的更改
      const hasUncommitted = await hasUncommittedChanges(repo.localPath);
      if (hasUncommitted) {
        const duration = Date.now() - startTime;
        const skipMsg = `存在未提交的更改，跳过更新`;
        const currentBranch = await getCurrentBranch(repo.localPath);
        console.log(chalk.yellow(`⏭️  跳过: ${repo.name} - ${skipMsg}`));
        
        return {
          name: repo.name,
          action: 'skipped',
          success: true,
          error: skipMsg,
          duration,
          path: repo.localPath,
          branch: currentBranch
        };
      }
      
      console.log(chalk.blue(`🔄 更新仓库: ${repo.name}`));
      // git fetch 所有远程分支
      await executeGitCommand(['fetch', '--all'], repo.localPath);

      // 切换到指定分支
      await executeGitCommand(['checkout', targetBranch], repo.localPath);
      
      // 执行 git pull
      await executeGitCommand(['pull'], repo.localPath);
      
      const duration = Date.now() - startTime;
      console.log(chalk.green(`✅ 更新成功: ${repo.name} (${duration}ms)`));
      
      return {
        name: repo.name,
        action: 'updated',
        success: true,
        duration,
        path: repo.localPath
      };
      
    } else {
      // 目录存在但不是 Git 仓库
      const duration = Date.now() - startTime;
      const errorMsg = `目录存在但不是Git仓库: ${repo.localPath}`;
      console.log(chalk.red(`❌ ${errorMsg}`));
      
      return {
        name: repo.name,
        action: 'error',
        success: false,
        error: errorMsg,
        duration,
        path: repo.localPath
      };
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`❌ 处理失败: ${repo.name} - ${errorMsg}`));
    
    return {
      name: repo.name,
      action: 'error',
      success: false,
      error: errorMsg,
      duration,
      path: repo.localPath
    };
  }
}

/**
 * 执行 Git 命令
 */
function executeGitCommand(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, {
      cwd: cwd || process.cwd(),
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    git.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    git.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    git.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git command failed: ${args.join(' ')}\n${stderr}`));
      }
    });
    
    git.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * 显示执行结果统计
 */
function showResults(results: CloneOrUpdateResult[]): void {
  console.log(chalk.cyan('\n📊 执行结果统计:'));
  
  const cloned = results.filter(r => r.action === 'cloned' && r.success);
  const updated = results.filter(r => r.action === 'updated' && r.success);
  const skipped = results.filter(r => r.action === 'skipped');
  const errors = results.filter(r => !r.success);
  
  console.log(chalk.green(`✅ 克隆成功: ${cloned.length} 个`));
  console.log(chalk.blue(`🔄 更新成功: ${updated.length} 个`));
  if (skipped.length > 0) {
    console.log(chalk.yellow(`⏭️  跳过: ${skipped.length} 个`));
  }
  console.log(chalk.red(`❌ 失败: ${errors.length} 个`));
  
  // 显示被跳过的仓库（有未提交更改的）
  if (skipped.length > 0) {
    console.log(chalk.yellow('\n⏭️  跳过的仓库（存在未提交的更改）:'));
    const skippedTable = new Table({
      head: [
        chalk.cyan('序号'),
        chalk.cyan('仓库名称'),
        chalk.cyan('分支名'),
        chalk.cyan('原因')
      ],
      style: {
        head: [],
        border: ['grey']
      },
      colWidths: [6, 25, 20, 30]
    });
    
    skipped.forEach((result, index) => {
      skippedTable.push([
        index + 1,
        result.name,
        result.branch || 'unknown',
        result.error || '存在未提交的更改'
      ]);
    });
    
    console.log(skippedTable.toString());
  }
  
  // 显示失败的仓库
  if (errors.length > 0) {
    console.log(chalk.red('\n❌ 失败的仓库:'));
    errors.forEach(result => {
      console.log(chalk.red(`  - ${result.name}: ${result.error}`));
    });
  }
  
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  console.log(chalk.gray(`\n总耗时: ${totalDuration}ms`));
}
