import { Command } from 'commander';
import chalk from 'chalk';
import { createProgressBar } from '../utils/progressBar';
import { configExists, loadConfig } from '../config';
import { resolveScanDirectories, scanAllGitProjects } from '../utils/directories';
import { RefPreference } from '../utils/gitRef';
import {
  BranchMergeCheckResult,
  checkBranchMergedInto,
  displayBranchMergeResults,
  renderBranchMergeCheckMarkdown
} from '../utils/mergeCheck';
import { ReportMeta, writeMarkdownReport } from '../utils/markdownReport';

export const intoCommand = new Command('into')
  .description('检查 source 分支是否已合并到 target 分支（source → target）')
  .argument('<target>', '目标分支 A（合并目标）')
  .argument('<source>', '源分支 B（待检查分支）')
  .option('-d, --directory <dir>', '项目目录（覆盖所有 group 目录，仅扫描指定目录）')
  .option('-g, --group <path>', '仅扫描指定 GitLab Group 的目录')
  .option('--no-fetch', '跳过 git fetch 操作')
  .option('--local', '检查本地分支（本地优先，远程兜底）')
  .option('--format <type>', '输出格式 (table|json|simple)', 'table')
  .option('-p, --parallel <number>', '并发处理数量', '5')
  .option('--show-missing', '显示不存在分支的项目')
  .option('-o, --output <file>', '将检查结果写入 Markdown 报告文件')
  .option('--merge-mode <mode>', '合并检测模式: strict|content|auto', 'auto')
  .action(async (targetBranch: string, sourceBranch: string, options) => {
    try {
      if (!configExists()) {
        console.error(chalk.red('❌ 配置文件不存在'));
        console.log(chalk.yellow('请先运行以下命令初始化配置:'));
        console.log(chalk.cyan('  feops init'));
        process.exit(1);
      }

      const config = loadConfig();
      const scanDirectories = resolveScanDirectories(config, {
        directory: options.directory,
        group: options.group
      });

      const refPreference: RefPreference = options.local ? 'local' : 'remote';
      const scopeLabel = refPreference === 'remote'
        ? '远程分支（origin/*，本地兜底）'
        : '本地分支（本地优先，远程兜底）';

      console.log(chalk.blue(`🔍 检查分支 "${sourceBranch}" 是否已合并到 "${targetBranch}"`));
      console.log(chalk.gray(`扫描目录: ${scanDirectories.join(', ')}`));
      console.log(chalk.gray(`Git fetch: ${options.fetch ? '启用' : '禁用'}`));
      console.log(chalk.gray(`检查范围: ${scopeLabel}`));
      console.log(chalk.gray(`合并检测: ${options.mergeMode}`));
      console.log('');

      const projects = scanAllGitProjects(config, {
        directory: options.directory,
        group: options.group
      });

      if (projects.length === 0) {
        console.error(chalk.red(`❌ 未找到 Git 项目`));
        process.exit(1);
      }

      console.log(chalk.blue(`📁 发现 ${projects.length} 个 Git 项目`));
      console.log('');

      const parallel = parseInt(options.parallel);
      const results: BranchMergeCheckResult[] = [];

      const progressBar = createProgressBar(projects.length, {
        prefix: '🔍 合并检查',
        showPercentage: true,
        showCount: true,
        width: 25
      });

      for (let i = 0; i < projects.length; i += parallel) {
        const batch = projects.slice(i, i + parallel);
        const batchPromises = batch.map(project =>
          Promise.resolve(checkBranchMergedInto(
            project.name,
            project.path,
            sourceBranch,
            targetBranch,
            refPreference,
            { fetch: options.fetch, mergeMode: options.mergeMode }
          ))
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        const processed = Math.min(i + parallel, projects.length);
        progressBar.update(processed);
      }

      console.log('');
      displayBranchMergeResults(
        results,
        options.format,
        sourceBranch,
        targetBranch,
        options.showMissing
      );

      if (options.output) {
        const reportMeta: ReportMeta = {
          command: `feops into ${targetBranch} ${sourceBranch}`,
          description: `检查 ${sourceBranch} 是否已合并到 ${targetBranch}`,
          scanDirectories,
          scopeLabel,
          fetchEnabled: options.fetch !== false
        };
        const md = renderBranchMergeCheckMarkdown(
          results,
          sourceBranch,
          targetBranch,
          reportMeta,
          options.showMissing,
          'feops into 检查报告'
        );
        const written = writeMarkdownReport(options.output, md);
        console.log(chalk.green(`\n报告已写入: ${written}`));
      }
    } catch (error) {
      console.error(chalk.red('❌ 执行失败:'), error);
      process.exit(1);
    }
  });
