import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import Table from 'cli-table3';
import { createProgressBar } from '../utils/progressBar';
import { configExists, loadConfig } from '../config';
import { resolveScanDirectories, scanAllGitProjects } from '../utils/directories';
import { RefPreference, resolveGitRef } from '../utils/gitRef';
import {
  mdTable,
  renderReportHeader,
  renderSummarySection,
  ReportMeta,
  writeMarkdownReport
} from '../utils/markdownReport';

interface BranchSearchResult {
  name: string;
  path: string;
  branchRef?: string;
  branchSource?: 'remote' | 'local';
  hasTargetBranch: boolean;
  fetchSuccess: boolean;
  error?: string;
}

export const branchCommand = new Command('branch')
  .description('查找包含指定分支的项目（默认检查 origin/* 远程跟踪分支）')
  .argument('<branch>', '要查找的分支名称')
  .option('-d, --directory <dir>', '项目目录（覆盖所有 group 目录，仅扫描指定目录）')
  .option('-g, --group <path>', '仅扫描指定 GitLab Group 的目录')
  .option('--no-fetch', '跳过 git fetch 操作')
  .option('--local', '仅检查本地分支（本地优先，远程兜底）')
  .option('--remote', '（已弃用，等同于默认行为）同时搜索远程分支')
  .option('--format <type>', '输出格式 (table|json|simple)', 'table')
  .option('-p, --parallel <number>', '并发处理数量', '5')
  .option('-o, --output <file>', '将检查结果写入 Markdown 报告文件')
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
      const scanDirectories = resolveScanDirectories(config, {
        directory: options.directory,
        group: options.group
      });

      const refPreference: RefPreference = options.local ? 'local' : 'remote';
      const scopeLabel = refPreference === 'remote'
        ? '远程分支（origin/*，本地兜底）'
        : '本地分支（本地优先，远程兜底）';

      if (options.remote && !options.local) {
        console.log(chalk.yellow('⚠️  --remote 已弃用，默认即检查远程分支'));
      }

      console.log(chalk.gray(`扫描目录: ${scanDirectories.join(', ')}`));
      console.log(chalk.gray(`Git fetch: ${options.fetch ? '启用' : '禁用'}`));
      console.log(chalk.gray(`搜索范围: ${scopeLabel}`));
      console.log('');

      const projects = scanAllGitProjects(config, {
        directory: options.directory,
        group: options.group
      });

      if (projects.length === 0) {
        console.error(chalk.red(`❌ 未找到 Git 项目`));
        if (!options.directory) {
          console.log(chalk.yellow('请确认 group 目录已存在，或使用 -d 指定目录'));
        }
        process.exit(1);
      }

      console.log(chalk.blue(`📁 找到 ${projects.length} 个 Git 项目`));
      console.log('');

      // 并发处理项目
      const parallel = parseInt(options.parallel);
      const results: BranchSearchResult[] = [];
      
      // 创建进度条
      const progressBar = createProgressBar(projects.length, {
        prefix: '🔍 搜索进度',
        showPercentage: true,
        showCount: true,
        width: 25
      });
      
      for (let i = 0; i < projects.length; i += parallel) {
        const batch = projects.slice(i, i + parallel);
        const batchPromises = batch.map(project => 
          processProject(project.name, project.path, branchName, refPreference, options)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // 更新进度条
        const processed = Math.min(i + parallel, projects.length);
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

      if (options.output) {
        const reportMeta: ReportMeta = {
          command: `feops branch ${branchName}`,
          description: `查找包含分支 ${branchName} 的项目`,
          scanDirectories,
          scopeLabel,
          fetchEnabled: options.fetch !== false
        };
        const md = renderBranchSearchMarkdown(results, branchName, reportMeta);
        const written = writeMarkdownReport(options.output, md);
        console.log(chalk.green(`\n报告已写入: ${written}`));
      }

    } catch (error) {
      console.error(chalk.red('❌ 执行失败:'), error);
      process.exit(1);
    }
  });

async function processProject(
  projectName: string, 
  projectPath: string, 
  branchName: string,
  refPreference: RefPreference,
  options: any
): Promise<BranchSearchResult> {
  const result: BranchSearchResult = {
    name: projectName,
    path: projectPath,
    hasTargetBranch: false,
    fetchSuccess: false
  };

  try {
    // 执行 git fetch（如果启用）
    if (options.fetch) {
      try {
        execSync('git fetch --all --prune', { 
          cwd: projectPath, 
          stdio: 'pipe',
          timeout: 30000 // 30秒超时
        });
        result.fetchSuccess = true;
      } catch (fetchError) {
        console.log(chalk.yellow(`⚠️  ${projectName}: git fetch 失败，继续使用已有分支信息`));
      }
    } else {
      result.fetchSuccess = true;
    }

    const resolved = resolveGitRef(projectPath, branchName, refPreference);
    result.hasTargetBranch = resolved.exists;
    if (resolved.exists && resolved.source !== 'none') {
      result.branchRef = resolved.ref;
      result.branchSource = resolved.source;
    }

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
        const refInfo = result.branchRef ? ` (${result.branchRef})` : '';
        console.log(`${index + 1}. ${result.name}${refInfo}`);
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
          chalk.cyan('匹配 Ref'),
          chalk.cyan('来源'),
          chalk.cyan('Fetch状态')
        ],
        style: {
          head: [],
          border: ['grey']
        },
        colWidths: [6, 30, 28, 10, 12]
      });

      // 添加数据行
      results.forEach((result, index) => {
        const fetchStatus = result.fetchSuccess ? 
          chalk.green('✓') : 
          (result.error ? chalk.red('✗') : chalk.yellow('⚠'));

        const truncatedName = result.name.length > 27 ? 
          result.name.substring(0, 24) + '...' : 
          result.name;

        const branchRef = result.branchRef || branchName;
        const truncatedRef = branchRef.length > 25 ? 
          branchRef.substring(0, 22) + '...' : 
          branchRef;

        const sourceLabel = result.branchSource === 'remote'
          ? chalk.blue('远程')
          : chalk.gray('本地');
        
        table.push([
          (index + 1).toString(),
          truncatedName,
          truncatedRef,
          sourceLabel,
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

export function renderBranchSearchMarkdown(
  results: BranchSearchResult[],
  branchName: string,
  meta: ReportMeta
): string {
  const matchedProjects = results.filter(r => r.hasTargetBranch);
  const failedProjects = results.filter(r => r.error);

  const sections = [
    renderReportHeader('feops branch 检查报告', meta, {
      查找分支: branchName
    }),
    '',
    renderSummarySection([
      ['总项目数', results.length],
      ['包含分支', matchedProjects.length],
      ['处理失败', failedProjects.length]
    ])
  ];

  if (matchedProjects.length > 0) {
    sections.push(
      '',
      '## 匹配项目',
      '',
      mdTable(
        ['序号', '项目', 'Ref', '来源', 'Fetch'],
        matchedProjects.map((result, index) => [
          String(index + 1),
          result.name,
          result.branchRef || branchName,
          result.branchSource === 'remote' ? '远程' : '本地',
          result.fetchSuccess ? '成功' : '失败'
        ])
      )
    );
  }

  if (failedProjects.length > 0) {
    sections.push(
      '',
      '## 处理失败',
      '',
      mdTable(
        ['项目', '错误信息'],
        failedProjects.map(r => [r.name, r.error || 'Unknown error'])
      )
    );
  }

  return sections.join('\n');
}
