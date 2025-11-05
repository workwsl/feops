import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import Table from 'cli-table3';
import { createProgressBar } from '../utils/progressBar';
import { configExists, loadConfig } from '../config';

interface MergeCheckResult {
  name: string;
  path: string;
  branchExists: boolean;
  masterExists: boolean;
  isMerged: boolean;
  mergeCommit?: string;
  mergeDate?: string;
  error?: string;
  fetchSuccess: boolean;
}

export const mergedCommand = new Command('merged')
  .description('检查指定分支是否已经合并到master分支（分支→master）')
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
      
      console.log(chalk.blue(`🔍 检查分支 "${branchName}" 是否已合并到 "${options.baseBranch}"`));
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
      const results: MergeCheckResult[] = [];
      
      // 创建进度条
      const progressBar = createProgressBar(projectDirs.length, {
        prefix: '🔍 合并检查',
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
): Promise<MergeCheckResult> {
  const projectPath = path.join(targetDir, projectName);
  
  const result: MergeCheckResult = {
    name: projectName,
    path: projectPath,
    branchExists: false,
    masterExists: false,
    isMerged: false,
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

    // 如果两个分支都存在，检查是否已合并
    if (result.branchExists && result.masterExists) {
      try {
        // 使用 git merge-base 检查是否已合并
        // 如果分支已经合并到master，那么分支的最新提交应该是master的祖先
        const branchCommit = execSync(`git rev-parse ${actualBranchRef}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        const masterCommit = execSync(`git rev-parse ${actualMasterRef}`, { 
          cwd: projectPath, 
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        // 检查分支提交是否是master的祖先
        try {
          execSync(`git merge-base --is-ancestor ${branchCommit} ${masterCommit}`, { 
            cwd: projectPath, 
            stdio: ['pipe', 'pipe', 'ignore'] 
          });
          result.isMerged = true;

          // 尝试找到合并提交信息
          try {
            const mergeInfo = execSync(
              `git log --oneline --merges --grep="Merge.*${branchName}" ${baseBranch} | head -1`, 
              { 
                cwd: projectPath, 
                stdio: ['pipe', 'pipe', 'ignore'],
                encoding: 'utf8'
              }
            ).trim();

            if (mergeInfo) {
                const commitParts = mergeInfo.split(' ');
                if (commitParts.length > 0 && commitParts[0]) {
                  result.mergeCommit = commitParts[0];
                }
              
              // 获取合并日期
              if (result.mergeCommit) {
                try {
                  const mergeDate = execSync(
                    `git log -1 --format="%ci" ${result.mergeCommit}`, 
                    { 
                      cwd: projectPath, 
                      stdio: ['pipe', 'pipe', 'ignore'],
                      encoding: 'utf8'
                    }
                  ).trim();
                  result.mergeDate = mergeDate;
                } catch {
                  // 忽略日期获取失败
                }
              }
            }
          } catch {
            // 忽略合并信息获取失败
          }

        } catch {
          result.isMerged = false;
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

function displayResults(results: MergeCheckResult[], format: string, branchName: string, baseBranch: string, showMissing: boolean = false) {
  const mergedResults = results.filter(r => r.isMerged);
  const notMergedResults = results.filter(r => r.branchExists && r.masterExists && !r.isMerged);
  const missingBranchResults = results.filter(r => !r.branchExists);
  const missingMasterResults = results.filter(r => !r.masterExists);
  const errorResults = results.filter(r => r.error);

  if (format === 'json') {
    console.log(JSON.stringify({
      summary: {
        total: results.length,
        merged: mergedResults.length,
        notMerged: notMergedResults.length,
        missingBranch: missingBranchResults.length,
        missingMaster: missingMasterResults.length,
        errors: errorResults.length
      },
      results: results
    }, null, 2));
    return;
  }

  if (format === 'simple') {
    console.log(chalk.green(`✅ 已合并 (${mergedResults.length}):`));
    mergedResults.forEach(r => {
      const dateInfo = r.mergeDate ? ` (${r.mergeDate.split(' ')[0]})` : '';
      console.log(`  ${r.name}${dateInfo}`);
    });

    if (notMergedResults.length > 0) {
      console.log(chalk.yellow(`⚠️  未合并 (${notMergedResults.length}):`));
      notMergedResults.forEach(r => console.log(`  ${r.name}`));
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
    

    if (notMergedResults.length > 0) {
      console.log(chalk.yellow(`⚠️  未合并到 ${baseBranch} (${notMergedResults.length} 个项目):`));
      notMergedResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

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
    // table 格式
    console.log(chalk.bold('📊 合并状态检查结果:'));
    console.log('');
    
    // 合并所有有效结果（已合并和未合并的）
    const validResults = [...mergedResults, ...notMergedResults];
    
    if (validResults.length > 0) {
      // 创建表格
      const table = new Table({
        head: [
          chalk.cyan('序号'),
          chalk.cyan('项目名称'),
          chalk.cyan('分支名称'),
          chalk.cyan('合并状态'),
          chalk.cyan('合并日期')
        ],
        style: {
          head: [],
          border: ['grey']
        },
        colWidths: [6, 30, 20, 12, 15]
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

        const status = result.isMerged ? chalk.green('✅ 已合并') : chalk.yellow('❌ 未合并');
        const mergeDate = result.mergeDate ? 
          result.mergeDate.split(' ')[0] : 
          (result.isMerged ? '-' : '-');

        table.push([
          (index + 1).toString(),
          truncatedName,
          truncatedBranch,
          status,
          mergeDate
        ]);
      });

      console.log(table.toString());
    }

    // 显示其他信息
    if (showMissing && missingBranchResults.length > 0) {
      console.log('');
      console.log(chalk.gray(`❌ 分支 "${branchName}" 不存在 (${missingBranchResults.length} 个项目):`));
      missingBranchResults.forEach(r => console.log(`  • ${r.name}`));
    }

    if (showMissing && missingMasterResults.length > 0) {
      console.log('');
      console.log(chalk.gray(`❌ 基准分支 "${baseBranch}" 不存在 (${missingMasterResults.length} 个项目):`));
      missingMasterResults.forEach(r => console.log(`  • ${r.name}`));
    }

    if (errorResults.length > 0) {
      console.log('');
      console.log(chalk.red(`🚫 处理错误 (${errorResults.length} 个项目):`));
      errorResults.forEach(r => console.log(`  • ${r.name}: ${r.error || 'Unknown error'}`));
    }
    console.log('');
  }

  // 统计信息
  console.log(chalk.blue('📈 统计信息:'));
  console.log(`  总项目数: ${results.length}`);
  console.log(`  已合并: ${chalk.green(mergedResults.length)}`);
  console.log(`  未合并: ${chalk.yellow(notMergedResults.length)}`);
  if (showMissing) {
    console.log(`  分支不存在: ${chalk.gray(missingBranchResults.length)}`);
    console.log(`  基准分支不存在: ${chalk.gray(missingMasterResults.length)}`);
  }
  console.log(`  处理错误: ${chalk.red(errorResults.length)}`);
}