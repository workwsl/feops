import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import Table from 'cli-table3';
import { createProgressBar } from '../utils/progressBar';
import { configExists, loadConfig } from '../config';

interface MasterMergeCheckResult {
  name: string;
  path: string;
  branchExists: boolean;
  masterExists: boolean;
  hasMasterChanges: boolean;
  isUpToDate: boolean;
  behindCommits: number;
  lastMasterCommit?: string;
  lastBranchCommit?: string;
  lastMasterDate?: string;
  lastBranchDate?: string;
  error?: string;
  fetchSuccess: boolean;
}

export const uptodateCommand = new Command('uptodate')
  .description('检查指定分支是否包含最新的master分支代码（master→分支）')
  .argument('<branch>', '要检查的分支名称')
  .option('-d, --directory <dir>', '项目目录（覆盖配置文件中的默认值）')
  .option('--no-fetch', '跳过 git fetch 操作')
  .option('--format <type>', '输出格式 (table|json|simple)', 'table')
  .option('-p, --parallel <number>', '并发处理数量', '5')
  .option('--base-branch <branch>', '基准分支名称', 'master')
  .option('--show-missing', '显示不存在分支的项目')
  .action(async (branchName: string, options) => {
    try {
      // 检查配置文件是否存在
      if (!configExists()) {
        console.error(chalk.red('❌ 配置文件不存在'));
        console.log(chalk.yellow('请先运行以下命令初始化配置:'));
        console.log(chalk.cyan('  feops init'));
        process.exit(1);
      }
      
      // 加载配置
      const config = loadConfig();
      const targetDir = path.resolve(options.directory || config.defaults.directory);
      
      console.log(chalk.blue(`🔍 检查分支 "${branchName}" 是否包含最新的 "${options.baseBranch}" 代码`));
      console.log(chalk.gray(`目标目录: ${targetDir}`));
      console.log(chalk.gray(`Git fetch: ${options.fetch ? '启用' : '禁用'}`));
      console.log('');

      if (!fs.existsSync(targetDir)) {
        console.error(chalk.red(`❌ 目标目录不存在: ${targetDir}`));
        process.exit(1);
      }

      // 获取所有项目目录
      const projectDirs = fs.readdirSync(targetDir)
        .filter(item => {
          const itemPath = path.join(targetDir, item);
          return fs.statSync(itemPath).isDirectory() && fs.existsSync(path.join(itemPath, '.git'));
        });

      console.log(chalk.blue(`📁 发现 ${projectDirs.length} 个 Git 项目`));
      console.log('');

      // 并发处理项目
      const parallel = parseInt(options.parallel);
      const results: MasterMergeCheckResult[] = [];
      
      // 创建进度条
      const progressBar = createProgressBar(projectDirs.length, {
        prefix: '🔍 主分支检查',
        showPercentage: true,
        showCount: true,
        width: 25
      });
      
      for (let i = 0; i < projectDirs.length; i += parallel) {
        const batch = projectDirs.slice(i, i + parallel);
        const batchPromises = batch.map(projectName => 
          processProject(projectName, targetDir, branchName, options.baseBranch, options)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // 更新进度条
        const processed = Math.min(i + parallel, projectDirs.length);
        progressBar.update(processed);
      }

      console.log('');
      displayResults(results, options.format, branchName, options.baseBranch, options.showMissing);

    } catch (error) {
      console.error(chalk.red('❌ 执行失败:'), error);
      process.exit(1);
    }
  });

async function processProject(
  projectName: string, 
  targetDir: string, 
  branchName: string,
  baseBranch: string,
  options: any
): Promise<MasterMergeCheckResult> {
  const projectPath = path.join(targetDir, projectName);
  
  const result: MasterMergeCheckResult = {
    name: projectName,
    path: projectPath,
    branchExists: false,
    masterExists: false,
    hasMasterChanges: false,
    isUpToDate: false,
    behindCommits: 0,
    fetchSuccess: false
  };

  let actualBranchRef = branchName;
  let actualMasterRef = baseBranch;

  try {
    // 切换到项目目录并执行 git fetch（如果启用）
    if (options.fetch) {
      try {
        execSync('git fetch --all --prune', { 
          cwd: projectPath, 
          stdio: 'pipe',
          timeout: 30000 
        });
        result.fetchSuccess = true;
      } catch (fetchError) {
        result.fetchSuccess = false;
        result.error = `Git fetch 失败: ${fetchError}`;
      }
    } else {
      result.fetchSuccess = true; // 跳过 fetch 时认为成功
    }

    // 检查基准分支是否存在
    try {
      execSync(`git rev-parse --verify ${baseBranch}`, { 
        cwd: projectPath, 
        stdio: ['pipe', 'pipe', 'ignore'] 
      });
      result.masterExists = true;
      actualMasterRef = baseBranch;
    } catch {
      // 尝试检查远程分支
      try {
        execSync(`git rev-parse --verify origin/${baseBranch}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'] 
        });
        result.masterExists = true;
        actualMasterRef = `origin/${baseBranch}`;
      } catch {
        result.masterExists = false;
      }
    }

    // 检查目标分支是否存在
    try {
      execSync(`git rev-parse --verify ${branchName}`, { 
        cwd: projectPath, 
        stdio: ['pipe', 'pipe', 'ignore'] 
      });
      result.branchExists = true;
      actualBranchRef = branchName;
    } catch {
      // 尝试检查远程分支
      try {
        execSync(`git rev-parse --verify origin/${branchName}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'] 
        });
        result.branchExists = true;
        actualBranchRef = `origin/${branchName}`;
      } catch {
        result.branchExists = false;
      }
    }

    // 如果两个分支都存在，检查master代码是否已合并到指定分支
    if (result.branchExists && result.masterExists) {
      try {
        // 获取master和分支的最新提交
        const masterCommit = execSync(`git rev-parse ${actualMasterRef}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        const branchCommit = execSync(`git rev-parse ${actualBranchRef}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        result.lastMasterCommit = masterCommit;
        result.lastBranchCommit = branchCommit;

        // 获取提交日期
        try {
          const masterDate = execSync(
            `git log -1 --format="%ci" ${masterCommit}`, 
            { 
              cwd: projectPath, 
              stdio: 'pipe',
              encoding: 'utf8'
            }
          ).trim();
          result.lastMasterDate = masterDate;
        } catch {
          // 忽略日期获取失败
        }

        try {
          const branchDate = execSync(
            `git log -1 --format="%ci" ${branchCommit}`, 
            { 
              cwd: projectPath, 
              stdio: 'pipe',
              encoding: 'utf8'
            }
          ).trim();
          result.lastBranchDate = branchDate;
        } catch {
          // 忽略日期获取失败
        }

        // 检查master是否是分支的祖先（即分支是否包含master的所有提交）
        try {
          execSync(`git merge-base --is-ancestor ${masterCommit} ${branchCommit}`, { 
            cwd: projectPath, 
            stdio: ['pipe', 'pipe', 'ignore'] 
          });
          result.isUpToDate = true;
          result.hasMasterChanges = false;
        } catch {
          // master不是分支的祖先，说明分支落后于master
          result.isUpToDate = false;
          result.hasMasterChanges = true;

          // 计算分支落后master多少个提交
          try {
            const behindCount = execSync(
              `git rev-list --count ${branchName}..${baseBranch}`, 
              { 
                cwd: projectPath, 
                stdio: 'pipe',
                encoding: 'utf8'
              }
            ).trim();
            result.behindCommits = parseInt(behindCount) || 0;
          } catch {
            result.behindCommits = 0;
          }
        }

      } catch (error) {
        result.error = `检查合并状态失败: ${error}`;
      }
    }

  } catch (error) {
    result.error = `处理项目失败: ${error}`;
  }

  return result;
}

function displayResults(results: MasterMergeCheckResult[], format: string, branchName: string, baseBranch: string, showMissing: boolean = false) {
  const upToDateResults = results.filter(r => r.isUpToDate);
  const behindResults = results.filter(r => r.hasMasterChanges && r.behindCommits > 0);
  const missingBranchResults = results.filter(r => !r.branchExists);
  const missingMasterResults = results.filter(r => !r.masterExists);
  const errorResults = results.filter(r => r.error);

  if (format === 'json') {
    console.log(JSON.stringify({
      summary: {
        total: results.length,
        upToDate: upToDateResults.length,
        behind: behindResults.length,
        missingBranch: missingBranchResults.length,
        missingMaster: missingMasterResults.length,
        errors: errorResults.length
      },
      results: results
    }, null, 2));
    return;
  }

  if (format === 'simple') {
    console.log(chalk.green(`✅ 已包含最新${baseBranch}代码 (${upToDateResults.length}):`));
    upToDateResults.forEach(r => {
      const dateInfo = r.lastBranchDate ? ` (${r.lastBranchDate.split(' ')[0]})` : '';
      console.log(`  ${r.name}${dateInfo}`);
    });

    if (behindResults.length > 0) {
      console.log(chalk.yellow(`⚠️  落后于${baseBranch} (${behindResults.length}):`));
      behindResults.forEach(r => {
        const commits = r.behindCommits > 0 ? ` (落后${r.behindCommits}个提交)` : '';
        console.log(`  ${r.name}${commits}`);
      });
    }

    if (showMissing && missingBranchResults.length > 0) {
      console.log(chalk.gray(`❌ 分支不存在 (${missingBranchResults.length}):`));
      missingBranchResults.forEach(r => console.log(`  ${r.name}`));
    }

    if (errorResults.length > 0) {
      console.log(chalk.red(`🚫 错误 (${errorResults.length}):`));
      errorResults.forEach(r => console.log(`  ${r.name}: ${r.error || 'Unknown error'}`));
    }
  } else {
    // table 格式 - 统一显示所有存在分支的项目
    console.log(chalk.bold('📊 Master代码合并状态检查结果:'));
    console.log('');
    
    // 获取所有存在分支的项目（排除分支不存在的项目）
    const validResults = results.filter(r => r.branchExists && r.masterExists);
    
    if (validResults.length > 0) {
      // 创建表格
      const table = new Table({
        head: [
          chalk.cyan('序号'),
          chalk.cyan('项目名称'),
          chalk.cyan('分支名称'),
          chalk.cyan('Master状态'),
          chalk.cyan('落后提交数')
        ],
        style: {
          head: [],
          border: ['grey']
        },
        colWidths: [6, 30, 20, 15, 12]
      });

      // 添加数据行
      validResults.forEach((result, index) => {
        // 截断过长的项目名称
        const truncatedName = result.name.length > 27 ? 
          result.name.substring(0, 24) + '...' : 
          result.name;

        // 截断过长的分支名称
        const truncatedBranch = branchName.length > 17 ? 
          branchName.substring(0, 14) + '...' : 
          branchName;

        const status = result.isUpToDate ? 
          chalk.green('✅ 已同步') : 
          chalk.yellow('❌ 落后');

        const behindCount = result.behindCommits > 0 ? 
          result.behindCommits.toString() : 
          '-';

        table.push([
          (index + 1).toString(),
          truncatedName,
          truncatedBranch,
          status,
          behindCount
        ]);
      });

      console.log(table.toString());
      console.log('');
    }

    // 显示其他信息
    if (showMissing && missingBranchResults.length > 0) {
      console.log(chalk.gray(`❌ 分支 "${branchName}" 不存在 (${missingBranchResults.length} 个项目):`));
      missingBranchResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

    if (showMissing && missingMasterResults.length > 0) {
      console.log(chalk.gray(`❌ 基准分支 "${baseBranch}" 不存在 (${missingMasterResults.length} 个项目):`));
      missingMasterResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

    if (errorResults.length > 0) {
      console.log(chalk.red(`🚫 处理错误 (${errorResults.length} 个项目):`));
      errorResults.forEach(r => console.log(`  • ${r.name}: ${r.error || 'Unknown error'}`));
      console.log('');
    }
  }

  // 统计信息
  console.log(chalk.blue('📈 统计信息:'));
  console.log(`  总项目数: ${results.length}`);
  console.log(`  已包含最新${baseBranch}代码: ${chalk.green(upToDateResults.length)}`);
  console.log(`  落后于${baseBranch}: ${chalk.yellow(behindResults.length)}`);
  if (showMissing) {
    console.log(`  分支不存在: ${chalk.gray(missingBranchResults.length)}`);
    console.log(`  基准分支不存在: ${chalk.gray(missingMasterResults.length)}`);
  }
  console.log(`  处理错误: ${chalk.red(errorResults.length)}`);
}