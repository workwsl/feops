#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { version } from '../package.json';
import { initCommand } from './commands/init';
import { configCommand } from './commands/config';
import { listCommand } from './commands/list';
import { syncCommand } from './commands/sync';
import { branchCommand } from './commands/branch';
import { mergedCommand } from './commands/merged';
import { uptodateCommand } from './commands/uptodate';
import { upgradeCommand } from './commands/upgrade';
import { checkForUpdates } from './utils/updateChecker';

const program = new Command();

// 在启动时检查更新（异步，不阻塞主程序）
checkForUpdates(version).catch(() => {
  // 静默失败
});

program
  .name('feops')
  .description('前端运维工具集 - 基于 Node.js 实现的前端运维工具，主要用于批量管理和同步前端仓库')
  .version(version)
  .option('-v, --verbose', 'enable verbose output')
  .option('--no-color', 'disable colored output');

// 添加子命令
program.addCommand(initCommand);
program.addCommand(configCommand);
program.addCommand(listCommand);
program.addCommand(syncCommand);
program.addCommand(branchCommand);
program.addCommand(mergedCommand);
program.addCommand(uptodateCommand);
program.addCommand(upgradeCommand);

// 添加示例和帮助信息
program.addHelpText('after', `
Examples:
  $ feops init                      # 初始化配置
  $ feops sync                      # 智能克隆或更新前端仓库
  $ feops sync --dry-run            # 预览模式，查看将要执行的操作
  $ feops list                      # 列出所有仓库信息
  $ feops branch main               # 查找包含 main 分支的项目
  $ feops branch feature/auth --remote  # 查找包含指定分支的项目（包括远程分支）
  $ feops merged feature/auth       # 检查 feature/auth 分支是否已合并到 master
  $ feops uptodate dev              # 检查 dev 分支是否包含最新 master 代码
  $ feops config list               # 查看配置
  $ feops upgrade                   # 检查并更新到最新版本
  $ feops upgrade --check           # 仅检查是否有更新

For more information:
  $ feops <command> --help
`);

// 解析命令行参数
program.parse();