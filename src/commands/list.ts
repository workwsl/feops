import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { configExists, loadConfig, loadBlacklist } from '../config';
import { GitLabService, Repository } from '../services/gitlab';

export const listCommand = new Command('list')
  .description('列出 GitLab API 中的仓库信息')
  .option('--filter <pattern>', '过滤仓库名称（支持正则表达式）')
  .option('--visibility <type>', '按可见性过滤 (public/private/internal)')
  .option('--sort <field>', '排序字段 (name/id)', 'name')
  .option('--reverse', '反向排序')
  .option('--limit <number>', '限制显示数量')
  .option('--format <type>', '输出格式 (table/json/simple)', 'table')
  .option('--show-archived', '显示已归档的仓库')
  .action(async (options) => {
    console.log(chalk.cyan('📋 Git 仓库列表'));
    
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
      const blacklist = loadBlacklist();
      
      console.log(chalk.gray('从 GitLab API 获取仓库列表...'));
      
      // 从 GitLab API 获取仓库列表
      const gitlabService = GitLabService.fromConfig();
      let projects = await gitlabService.fetchAllConfiguredProjects();
      
      console.log(chalk.gray(`找到 ${projects.length} 个仓库`));
      
      // 过滤已归档的仓库（除非指定显示）
      if (!options.showArchived) {
        projects = projects.filter(project => !project.archived);
        console.log(chalk.gray(`过滤掉已归档仓库后剩余: ${projects.length} 个`));
      }
      
      // 过滤
      if (options.filter) {
        const filterRegex = new RegExp(options.filter, 'i');
        projects = projects.filter(project => 
          filterRegex.test(project.name) || 
          filterRegex.test(project.description || '') ||
          filterRegex.test(project.full_name)
        );
        console.log(chalk.gray(`按过滤条件 "${options.filter}" 过滤后剩余: ${projects.length} 个仓库`));
      }
      
      if (options.visibility) {
        projects = projects.filter(project => 
          project.visibility.toLowerCase() === options.visibility.toLowerCase()
        );
        console.log(chalk.gray(`按可见性 "${options.visibility}" 过滤后剩余: ${projects.length} 个仓库`));
      }
      
      // 排序
      projects.sort((a, b) => {
        let aValue: any, bValue: any;
        
        switch (options.sort) {
          case 'id':
            aValue = a.id;
            bValue = b.id;
            break;
          case 'name':
          default:
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
        }
        
        if (aValue < bValue) return options.reverse ? 1 : -1;
        if (aValue > bValue) return options.reverse ? -1 : 1;
        return 0;
      });
      
      // 限制数量
      if (options.limit) {
        const limit = parseInt(options.limit);
        projects = projects.slice(0, limit);
        console.log(chalk.gray(`限制显示前 ${limit} 个仓库`));
      }
      
      if (projects.length === 0) {
        console.log(chalk.yellow('没有找到匹配的仓库'));
        return;
      }
      
      // 输出
      switch (options.format) {
        case 'json':
          console.log(JSON.stringify(projects, null, 2));
          break;
        case 'simple':
          projects.forEach(project => {
            const blacklistMark = blacklist.includes(project.name) ? chalk.red(' [黑名单]') : '';
            const archivedMark = project.archived ? chalk.yellow(' [已归档]') : '';
            console.log(`${project.name} - ${project.description || '无描述'}${blacklistMark}${archivedMark}`);
          });
          break;
        case 'table':
        default:
          displayTable(projects, blacklist);
          break;
      }
      
      // 统计信息
      if (options.format === 'table') {
        console.log(chalk.cyan(`\n📊 统计信息:`));
        console.log(chalk.gray(`总计: ${projects.length} 个仓库`));
        
        const visibilityStats = projects.reduce((acc, project) => {
          acc[project.visibility] = (acc[project.visibility] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        Object.entries(visibilityStats).forEach(([visibility, count]) => {
          console.log(chalk.gray(`${visibility}: ${count} 个`));
        });
        
        const blacklistCount = projects.filter(p => blacklist.includes(p.name)).length;
        if (blacklistCount > 0) {
          console.log(chalk.gray(`黑名单: ${blacklistCount} 个`));
        }
        
        if (options.showArchived) {
          const archivedCount = projects.filter(p => p.archived).length;
          console.log(chalk.gray(`已归档: ${archivedCount} 个`));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('❌ 获取仓库列表失败:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

function displayTable(projects: Repository[], blacklist: string[]) {
  console.log(chalk.cyan('\n📦 仓库列表:'));
  
  // 创建表格实例
  const table = new Table({
    head: [
      chalk.bold.cyan('序号'),
      chalk.bold.cyan('名称'),
      chalk.bold.cyan('描述'),
      chalk.bold.cyan('可见性'),
      chalk.bold.cyan('状态')
    ],
    colWidths: [6, 25, 40, 12, 15],
    style: {
      head: [],
      border: ['gray']
    },
    chars: {
      'top': '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      'bottom': '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      'left': '│',
      'left-mid': '├',
      'mid': '─',
      'mid-mid': '┼',
      'right': '│',
      'right-mid': '┤',
      'middle': '│'
    }
  });
  
  // 添加数据行
  projects.forEach((project, index) => {
    const name = project.name.length > 22 
      ? project.name.substring(0, 19) + '...'
      : project.name;
    
    const description = (project.description || '无描述').length > 37
      ? (project.description || '无描述').substring(0, 34) + '...'
      : (project.description || '无描述');
    
    const visibility = getVisibilityColor(project.visibility);
    
    let status = chalk.green('正常');
    if (project.archived) {
      status = chalk.yellow('已归档');
    } else if (blacklist.includes(project.name)) {
      status = chalk.red('黑名单');
    }
    
    table.push([
      chalk.gray(index + 1),
      chalk.white(name),
      chalk.gray(description),
      visibility,
      status
    ]);
  });
  
  console.log(table.toString());
}

function getVisibilityColor(visibility: string): string {
  switch (visibility.toLowerCase()) {
    case 'public':
      return chalk.green(visibility);
    case 'private':
      return chalk.red(visibility);
    case 'internal':
      return chalk.yellow(visibility);
    default:
      return chalk.gray(visibility);
  }
}
