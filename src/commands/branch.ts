import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import Table from 'cli-table3';
import { createProgressBar } from '../utils/progressBar';
import { configExists, loadConfig } from '../config';

interface BranchSearchResult {
  name: string;
  path: string;
  branches: string[];
  hasTargetBranch: boolean;
  fetchSuccess: boolean;
  error?: string;
}

export const branchCommand = new Command('branch')
  .description('查找包含指定分支的项目（会先执行 git fetch 同步分支信息）')
  .argument('<branch>', '要查找的分支名称')
  .option('-d, --directory <dir>', '项目目录（覆盖配置文件中的默认值）')
  .option('--no-fetch', '跳过 git fetch 操作')
  .option('--remote', '同时搜索远程分支')
  .option('--format <type>', '输出格式 (table|json|simple)', 'table')
  .option('-p, --parallel <number>', '并发处理数量', '5')
  .action(async (branchName: string, options) => {
    try {
      console.log(chalk.blue(`🔍 查找包含分支 "${branchName}" 的项目`));
      
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
      
      console.log(chalk.gray(`目标目录: ${targetDir}`));
      console.log(chalk.gray(`Git fetch: ${options.fetch ? '启用' : '禁用'}`));
      console.log(chalk.gray(`搜索远程分支: ${options.remote ? '是' : '否'}`));
      console.log('');

      // 获取目标目录中的所有项目
      if (!fs.existsSync(targetDir)) {
        console.error(chalk.red(`❌ 目标目录不存在: ${targetDir}`));
        process.exit(1);
      }

      const projectDirs = fs.readdirSync(targetDir)
        .filter(dir => {
          const fullPath = path.join(targetDir, dir);
          return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, '.git'));
        });

      console.log(chalk.blue(`📁 找到 ${projectDirs.length} 个 Git 项目`));
      console.log('');

      // 并发处理项目
      const parallel = parseInt(options.parallel);
      const results: BranchSearchResult[] = [];
      
      // 创建进度条
      const progressBar = createProgressBar(projectDirs.length, {
        prefix: '🔍 搜索进度',
        showPercentage: true,
        showCount: true,
        width: 25
      });
      
      for (let i = 0; i < projectDirs.length; i += parallel) {
        const batch = projectDirs.slice(i, i + parallel);
        const batchPromises = batch.map(projectName => 
          processProject(projectName, targetDir, branchName, options)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // 更新进度条
        const processed = Math.min(i + parallel, projectDirs.length);
        progressBar.update(processed);
      }

      // 过滤出包含目标分支的项目
      const matchedProjects = results.filter(result => result.hasTargetBranch);
      const failedProjects = results.filter(result => result.error);

      console.log('');
      console.log(chalk.green(`✅ 搜索完成！`));
      console.log(chalk.blue(`📊 统计信息:`));
      console.log(`  - 总项目数: ${results.length}`);
      console.log(`  - 包含分支 "${branchName}" 的项目: ${chalk.green(matchedProjects.length)}`);
      console.log(`  - 处理失败的项目: ${chalk.red(failedProjects.length)}`);
      console.log('');

      // 输出结果
      if (matchedProjects.length > 0) {
        displayResults(matchedProjects, options.format, branchName);
      } else {
        console.log(chalk.yellow(`⚠️  没有找到包含分支 "${branchName}" 的项目`));
      }

      // 显示失败的项目
      if (failedProjects.length > 0) {
        console.log('');
        console.log(chalk.red(`❌ 处理失败的项目:`));
        failedProjects.forEach(project => {
          console.log(`  - ${project.name}: ${project.error}`);
        });
      }

    } catch (error) {
      console.error(chalk.red('❌ 执行失败:'), error);
      process.exit(1);
    }
  });

async function processProject(
  projectName: string, 
  targetDir: string, 
  branchName: string, 
  options: any
): Promise<BranchSearchResult> {
  const projectPath = path.join(targetDir, projectName);
  const result: BranchSearchResult = {
    name: projectName,
    path: projectPath,
    branches: [],
    hasTargetBranch: false,
    fetchSuccess: false
  };

  try {
    // 执行 git fetch（如果启用）
    if (options.fetch) {
      try {
        execSync('git fetch --all', { 
          cwd: projectPath, 
          stdio: 'pipe',
          timeout: 30000 // 30秒超时
        });
        result.fetchSuccess = true;
      } catch (fetchError) {
        console.log(chalk.yellow(`⚠️  ${projectName}: git fetch 失败，继续使用本地分支信息`));
      }
    }

    // 获取分支列表
    const branchCommand = options.remote 
      ? 'git branch -a' 
      : 'git branch';
    
    const branchOutput = execSync(branchCommand, { 
      cwd: projectPath, 
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    const branches = branchOutput
      .split('\n')
      .map(line => line.trim().replace(/^\*\s*/, '').replace(/^remotes\/origin\//, ''))
      .filter(line => line && !line.includes('HEAD ->'))
      .filter((branch, index, arr) => arr.indexOf(branch) === index); // 去重

    result.branches = branches;
    result.hasTargetBranch = branches.some(branch => 
      branch === branchName
    );

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function displayResults(results: BranchSearchResult[], format: string, branchName: string) {
  switch (format) {
    case 'json':
      console.log(JSON.stringify(results, null, 2));
      break;
    
    case 'simple':
      console.log(chalk.green(`📋 包含分支 "${branchName}" 的项目:`));
      results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.name}`);
      });
      break;
    
    case 'table':
    default:
      console.log(chalk.green(`📋 包含分支 "${branchName}" 的项目详情:`));
      console.log('');
      
      if (results.length === 0) {
        console.log(chalk.yellow('没有找到匹配的项目'));
        return;
      }

      // 创建表格
      const table = new Table({
        head: [
          chalk.cyan('序号'),
          chalk.cyan('项目名称'),
          chalk.cyan('匹配的分支'),
          chalk.cyan('Fetch状态')
        ],
        style: {
          head: [],
          border: ['grey']
        },
        colWidths: [6, 35, 40, 12]
      });

      // 添加数据行
      results.forEach((result, index) => {
        const matchedBranches = result.branches.filter(branch => 
          branch === branchName || branch.includes(branchName)
        );
        
        const branchText = matchedBranches.slice(0, 2).join(', ') + 
          (matchedBranches.length > 2 ? ` (+${matchedBranches.length - 2})` : '');
        
        const fetchStatus = result.fetchSuccess ? 
          chalk.green('✓') : 
          (result.error ? chalk.red('✗') : chalk.yellow('⚠'));

        // 截断过长的项目名称
        const truncatedName = result.name.length > 32 ? 
          result.name.substring(0, 29) + '...' : 
          result.name;

        // 截断过长的分支信息
        const truncatedBranch = branchText.length > 37 ? 
          branchText.substring(0, 34) + '...' : 
          branchText;
        
        table.push([
          (index + 1).toString(),
          truncatedName,
          truncatedBranch,
          fetchStatus
        ]);
      });

      console.log(table.toString());
      
      // 显示统计信息
      console.log('');
      console.log(chalk.blue('📊 统计信息:'));
      console.log(`  找到匹配项目: ${chalk.green(results.length)} 个`);
      const successCount = results.filter(r => r.fetchSuccess).length;
      const failCount = results.filter(r => r.error).length;
      console.log(`  Fetch 成功: ${chalk.green(successCount)} 个`);
      if (failCount > 0) {
        console.log(`  Fetch 失败: ${chalk.red(failCount)} 个`);
      }
      break;
  }
}
