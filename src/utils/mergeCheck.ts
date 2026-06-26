import chalk from 'chalk';
import { execSync } from 'child_process';
import Table from 'cli-table3';
import { RefPreference, resolveGitRef } from './gitRef';
import {
  mdTable,
  renderReportHeader,
  renderSummarySection,
  ReportMeta
} from './markdownReport';

export type MergeMode = 'strict' | 'content' | 'auto';
export type MergeDetectionMode = 'strict' | 'content' | 'none';

export interface BranchMergeCheckResult {
  name: string;
  path: string;
  sourceExists: boolean;
  targetExists: boolean;
  sourceRef?: string;
  targetRef?: string;
  isMerged: boolean;
  mergeMode?: MergeDetectionMode;
  pendingCommits?: number;
  mergeCommit?: string;
  mergeDate?: string;
  error?: string;
  fetchSuccess: boolean;
}

export interface MergeCheckOptions {
  fetch?: boolean;
  mergeMode?: MergeMode;
}

function isStrictAncestor(
  projectPath: string,
  sourceCommit: string,
  targetCommit: string
): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${sourceCommit} ${targetCommit}`, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function countPendingCherryCommits(
  projectPath: string,
  targetRef: string,
  sourceRef: string
): number {
  try {
    const output = execSync(`git cherry ${targetRef} ${sourceRef}`, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();

    if (!output) {
      return 0;
    }

    return output
      .split('\n')
      .filter(line => line.startsWith('+'))
      .length;
  } catch {
    return -1;
  }
}

function tryLoadMergeInfo(
  projectPath: string,
  sourceBranch: string,
  targetRef: string
): { mergeCommit?: string; mergeDate?: string } {
  try {
    const mergeInfo = execSync(
      `git log --oneline --merges --grep="Merge.*${sourceBranch}" ${targetRef} | head -1`,
      {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8'
      }
    ).trim();

    if (!mergeInfo) {
      return {};
    }

    const commitParts = mergeInfo.split(' ');
    const mergeCommit = commitParts[0];
    if (!mergeCommit) {
      return {};
    }

    try {
      const mergeDate = execSync(
        `git log -1 --format="%ci" ${mergeCommit}`,
        {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }
      ).trim();
      return { mergeCommit, mergeDate };
    } catch {
      return { mergeCommit };
    }
  } catch {
    return {};
  }
}

function evaluateMergeStatus(
  projectPath: string,
  sourceBranch: string,
  actualSourceRef: string,
  actualTargetRef: string,
  sourceCommit: string,
  targetCommit: string,
  mergeMode: MergeMode
): Pick<BranchMergeCheckResult, 'isMerged' | 'mergeMode' | 'pendingCommits' | 'mergeCommit' | 'mergeDate'> {
  const pendingCount = countPendingCherryCommits(projectPath, actualTargetRef, actualSourceRef);
  const pendingCommits = pendingCount >= 0 ? pendingCount : undefined;
  const contentMerged = pendingCount === 0;
  const strictMerged = isStrictAncestor(projectPath, sourceCommit, targetCommit);

  if (mergeMode === 'strict') {
    const mergeInfo = strictMerged
      ? tryLoadMergeInfo(projectPath, sourceBranch, actualTargetRef)
      : {};
    return {
      isMerged: strictMerged,
      mergeMode: strictMerged ? 'strict' : 'none',
      ...(pendingCommits !== undefined ? { pendingCommits } : {}),
      ...mergeInfo
    };
  }

  if (mergeMode === 'content') {
    const merged = contentMerged && pendingCount >= 0;
    const mergeInfo = merged
      ? tryLoadMergeInfo(projectPath, sourceBranch, actualTargetRef)
      : {};
    return {
      isMerged: merged,
      mergeMode: merged ? 'content' : 'none',
      ...(pendingCommits !== undefined ? { pendingCommits } : {}),
      ...mergeInfo
    };
  }

  if (strictMerged) {
    return {
      isMerged: true,
      mergeMode: 'strict',
      ...(pendingCommits !== undefined ? { pendingCommits } : {}),
      ...tryLoadMergeInfo(projectPath, sourceBranch, actualTargetRef)
    };
  }

  if (contentMerged && pendingCount >= 0) {
    return {
      isMerged: true,
      mergeMode: 'content',
      pendingCommits: 0,
      ...tryLoadMergeInfo(projectPath, sourceBranch, actualTargetRef)
    };
  }

  return {
    isMerged: false,
    mergeMode: 'none',
    ...(pendingCommits !== undefined ? { pendingCommits } : {})
  };
}

export function checkBranchMergedInto(
  projectName: string,
  projectPath: string,
  sourceBranch: string,
  targetBranch: string,
  refPreference: RefPreference,
  options: MergeCheckOptions
): BranchMergeCheckResult {
  const result: BranchMergeCheckResult = {
    name: projectName,
    path: projectPath,
    sourceExists: false,
    targetExists: false,
    isMerged: false,
    fetchSuccess: false
  };

  let actualSourceRef = sourceBranch;
  let actualTargetRef = targetBranch;

  try {
    if (options.fetch !== false) {
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
      result.fetchSuccess = true;
    }

    const resolvedTarget = resolveGitRef(projectPath, targetBranch, refPreference);
    result.targetExists = resolvedTarget.exists;
    if (resolvedTarget.exists) {
      actualTargetRef = resolvedTarget.ref;
      result.targetRef = resolvedTarget.ref;
    }

    const resolvedSource = resolveGitRef(projectPath, sourceBranch, refPreference);
    result.sourceExists = resolvedSource.exists;
    if (resolvedSource.exists) {
      actualSourceRef = resolvedSource.ref;
      result.sourceRef = resolvedSource.ref;
    }

    if (result.sourceExists && result.targetExists) {
      try {
        const sourceCommit = execSync(`git rev-parse ${actualSourceRef}`, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        const targetCommit = execSync(`git rev-parse ${actualTargetRef}`, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf8'
        }).trim();

        const mergeMode = options.mergeMode ?? 'auto';
        const status = evaluateMergeStatus(
          projectPath,
          sourceBranch,
          actualSourceRef,
          actualTargetRef,
          sourceCommit,
          targetCommit,
          mergeMode
        );
        Object.assign(result, status);
      } catch (error) {
        result.error = `检查合并状态失败: ${error}`;
      }
    }
  } catch (error) {
    result.error = `处理项目失败: ${error}`;
  }

  return result;
}

export type MergeCheckJsonKeyStyle = 'source-target' | 'branch-base';

export interface MergeCheckDisplayLabels {
  sourceColumnHeader: string;
  missingSourceLabel: string;
  missingTargetLabel: string;
  statsMissingSourceLabel: string;
  statsMissingTargetLabel: string;
}

const defaultDisplayLabels: MergeCheckDisplayLabels = {
  sourceColumnHeader: '源分支',
  missingSourceLabel: '分支',
  missingTargetLabel: '目标分支',
  statsMissingSourceLabel: '源分支不存在',
  statsMissingTargetLabel: '目标分支不存在'
};

export const legacyMergedDisplayLabels: MergeCheckDisplayLabels = {
  sourceColumnHeader: '分支名称',
  missingSourceLabel: '分支',
  missingTargetLabel: '基准分支',
  statsMissingSourceLabel: '分支不存在',
  statsMissingTargetLabel: '基准分支不存在'
};

function serializeResultsForJson(
  results: BranchMergeCheckResult[],
  keyStyle: MergeCheckJsonKeyStyle
) {
  if (keyStyle === 'branch-base') {
    return results.map(r => ({
      name: r.name,
      path: r.path,
      branchExists: r.sourceExists,
      masterExists: r.targetExists,
      branchRef: r.sourceRef,
      baseRef: r.targetRef,
      isMerged: r.isMerged,
      mergeMode: r.mergeMode,
      pendingCommits: r.pendingCommits,
      mergeCommit: r.mergeCommit,
      mergeDate: r.mergeDate,
      error: r.error,
      fetchSuccess: r.fetchSuccess
    }));
  }

  return results;
}

function formatMergeModeLabel(mode?: MergeDetectionMode): string {
  switch (mode) {
    case 'strict':
      return 'strict';
    case 'content':
      return 'content';
    default:
      return '-';
  }
}

function formatPendingCommits(count?: number): string {
  if (count === undefined) {
    return '-';
  }
  return count > 0 ? String(count) : '-';
}

export function displayBranchMergeResults(
  results: BranchMergeCheckResult[],
  format: string,
  sourceBranch: string,
  targetBranch: string,
  showMissing: boolean = false,
  jsonKeyStyle: MergeCheckJsonKeyStyle = 'source-target',
  labels: MergeCheckDisplayLabels = defaultDisplayLabels
): void {
  const mergedResults = results.filter(r => r.isMerged);
  const notMergedResults = results.filter(r => r.sourceExists && r.targetExists && !r.isMerged);
  const missingSourceResults = results.filter(r => !r.sourceExists);
  const missingTargetResults = results.filter(r => !r.targetExists);
  const errorResults = results.filter(r => r.error);

  if (format === 'json') {
    const serialized = serializeResultsForJson(results, jsonKeyStyle);
    console.log(JSON.stringify({
      summary: {
        total: results.length,
        merged: mergedResults.length,
        notMerged: notMergedResults.length,
        missingSource: missingSourceResults.length,
        missingTarget: missingTargetResults.length,
        missingBranch: missingSourceResults.length,
        missingMaster: missingTargetResults.length,
        errors: errorResults.length
      },
      results: serialized
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

    if (showMissing && missingSourceResults.length > 0) {
      console.log(chalk.gray(`❌ 源分支不存在 (${missingSourceResults.length}):`));
      missingSourceResults.forEach(r => console.log(`  ${r.name}`));
    }

    if (errorResults.length > 0) {
      console.log(chalk.red(`🚫 错误 (${errorResults.length}):`));
      errorResults.forEach(r => console.log(`  ${r.name}: ${r.error || 'Unknown error'}`));
    }
  } else {
    if (notMergedResults.length > 0) {
      console.log(chalk.yellow(`⚠️  未合并到 ${targetBranch} (${notMergedResults.length} 个项目):`));
      notMergedResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

    if (showMissing && missingSourceResults.length > 0) {
      console.log(chalk.gray(`❌ ${labels.missingSourceLabel} "${sourceBranch}" 不存在 (${missingSourceResults.length} 个项目):`));
      missingSourceResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

    if (showMissing && missingTargetResults.length > 0) {
      console.log(chalk.gray(`❌ ${labels.missingTargetLabel} "${targetBranch}" 不存在 (${missingTargetResults.length} 个项目):`));
      missingTargetResults.forEach(r => console.log(`  • ${r.name}`));
      console.log('');
    }

    if (errorResults.length > 0) {
      console.log(chalk.red(`🚫 处理错误 (${errorResults.length} 个项目):`));
      errorResults.forEach(r => console.log(`  • ${r.name}: ${r.error || 'Unknown error'}`));
      console.log('');
    }

    console.log(chalk.bold('📊 合并状态检查结果:'));
    console.log('');

    const validResults = [...mergedResults, ...notMergedResults];

    if (validResults.length > 0) {
      const table = new Table({
        head: [
          chalk.cyan('序号'),
          chalk.cyan('项目名称'),
          chalk.cyan('源 Ref'),
          chalk.cyan('目标 Ref'),
          chalk.cyan('合并状态'),
          chalk.cyan('检测模式'),
          chalk.cyan('待合入'),
          chalk.cyan('合并日期')
        ],
        style: {
          head: [],
          border: ['grey']
        },
        colWidths: [6, 24, 18, 18, 10, 10, 8, 12]
      });

      validResults.forEach((result, index) => {
        const truncatedName = result.name.length > 21 ?
          result.name.substring(0, 18) + '...' :
          result.name;

        const sourceRef = result.sourceRef ?? '-';
        const targetRef = result.targetRef ?? '-';
        const truncatedSourceRef = sourceRef.length > 15 ?
          sourceRef.substring(0, 12) + '...' :
          sourceRef;
        const truncatedTargetRef = targetRef.length > 15 ?
          targetRef.substring(0, 12) + '...' :
          targetRef;

        const status = result.isMerged ? chalk.green('✅ 已合并') : chalk.yellow('❌ 未合并');
        const mergeDate = result.mergeDate ?
          result.mergeDate.split(' ')[0] :
          '-';

        table.push([
          (index + 1).toString(),
          truncatedName,
          truncatedSourceRef,
          truncatedTargetRef,
          status,
          formatMergeModeLabel(result.mergeMode),
          formatPendingCommits(result.pendingCommits),
          mergeDate
        ]);
      });

      console.log(table.toString());
    }

    if (showMissing && missingSourceResults.length > 0) {
      console.log('');
      console.log(chalk.gray(`❌ ${labels.missingSourceLabel} "${sourceBranch}" 不存在 (${missingSourceResults.length} 个项目):`));
      missingSourceResults.forEach(r => console.log(`  • ${r.name}`));
    }

    if (showMissing && missingTargetResults.length > 0) {
      console.log('');
      console.log(chalk.gray(`❌ ${labels.missingTargetLabel} "${targetBranch}" 不存在 (${missingTargetResults.length} 个项目):`));
      missingTargetResults.forEach(r => console.log(`  • ${r.name}`));
    }

    if (errorResults.length > 0) {
      console.log('');
      console.log(chalk.red(`🚫 处理错误 (${errorResults.length} 个项目):`));
      errorResults.forEach(r => console.log(`  • ${r.name}: ${r.error || 'Unknown error'}`));
    }
    console.log('');
  }

  console.log(chalk.blue('📈 统计信息:'));
  console.log(`  总项目数: ${results.length}`);
  console.log(`  已合并: ${chalk.green(mergedResults.length)}`);
  console.log(`  未合并: ${chalk.yellow(notMergedResults.length)}`);
  if (showMissing) {
    console.log(`  ${labels.statsMissingSourceLabel}: ${chalk.gray(missingSourceResults.length)}`);
    console.log(`  ${labels.statsMissingTargetLabel}: ${chalk.gray(missingTargetResults.length)}`);
  }
  console.log(`  处理错误: ${chalk.red(errorResults.length)}`);
}

export function renderBranchMergeCheckMarkdown(
  results: BranchMergeCheckResult[],
  sourceBranch: string,
  targetBranch: string,
  meta: ReportMeta,
  showMissing: boolean = false,
  reportTitle: string = 'feops 合并检查报告'
): string {
  const mergedResults = results.filter(r => r.isMerged);
  const notMergedResults = results.filter(r => r.sourceExists && r.targetExists && !r.isMerged);
  const missingSourceResults = results.filter(r => !r.sourceExists);
  const missingTargetResults = results.filter(r => !r.targetExists);
  const errorResults = results.filter(r => r.error);
  const validResults = [...mergedResults, ...notMergedResults];

  const sections = [
    renderReportHeader(reportTitle, meta, {
      源分支: sourceBranch,
      目标分支: targetBranch
    }),
    '',
    renderSummarySection([
      ['总项目数', results.length],
      ['已合并', mergedResults.length],
      ['未合并', notMergedResults.length],
      ['源分支不存在', missingSourceResults.length],
      ['目标分支不存在', missingTargetResults.length],
      ['处理错误', errorResults.length]
    ])
  ];

  if (validResults.length > 0) {
    sections.push(
      '',
      '## 结果明细',
      '',
      mdTable(
        ['序号', '项目', '源 Ref', '目标 Ref', '状态', '检测模式', '待合入', '合并日期'],
        validResults.map((result, index) => [
          String(index + 1),
          result.name,
          result.sourceRef ?? '-',
          result.targetRef ?? '-',
          result.isMerged ? '已合并' : '未合并',
          formatMergeModeLabel(result.mergeMode),
          formatPendingCommits(result.pendingCommits),
          result.mergeDate?.split(' ')[0] ?? '-'
        ] as string[])
      )
    );
  }

  if (showMissing && missingSourceResults.length > 0) {
    sections.push(
      '',
      '## 源分支不存在',
      '',
      mdTable(
        ['项目', '路径'],
        missingSourceResults.map(r => [r.name, r.path])
      )
    );
  }

  if (showMissing && missingTargetResults.length > 0) {
    sections.push(
      '',
      '## 目标分支不存在',
      '',
      mdTable(
        ['项目', '路径'],
        missingTargetResults.map(r => [r.name, r.path])
      )
    );
  }

  if (errorResults.length > 0) {
    sections.push(
      '',
      '## 处理错误',
      '',
      mdTable(
        ['项目', '错误信息'],
        errorResults.map(r => [r.name, r.error || 'Unknown error'])
      )
    );
  }

  return sections.join('\n');
}
