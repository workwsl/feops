import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  getBlacklistPath,
  loadBlacklist,
  saveBlacklist,
  configExists,
  GitLabGroup
} from '../config';
import { GitLabService } from '../services/gitlab';

export const configCommand = new Command('config')
  .description('管理 feops 配置');

// config list - 显示当前配置
configCommand
  .command('list')
  .description('显示当前配置')
  .option('--show-token', '显示完整的 GitLab Token')
  .action((options) => {
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }

    try {
      const config = loadConfig();
      const blacklist = loadBlacklist();

      console.log(chalk.cyan('📋 当前配置:'));
      console.log('');
      
      console.log(chalk.bold('GitLab 配置:'));
      console.log(chalk.gray(`  URL: ${config.gitlab.url}`));
      
      if (options.showToken) {
        console.log(chalk.gray(`  Token: ${config.gitlab.token}`));
      } else {
        const maskedToken = config.gitlab.token.substring(0, 8) + '***';
        console.log(chalk.gray(`  Token: ${maskedToken} (使用 --show-token 显示完整)`));
      }
      
      console.log(chalk.gray(`  Groups: ${config.gitlab.groups.length} 个`));
      config.gitlab.groups.forEach((group, index) => {
        console.log(chalk.gray(`    ${index + 1}. ${group.path}${group.description ? ` - ${group.description}` : ''}`));
      });
      
      console.log('');
      console.log(chalk.bold('默认配置:'));
      console.log(chalk.gray(`  目录: ${config.defaults.directory}`));
      console.log(chalk.gray(`  分支: ${config.defaults.branch}`));
      console.log(chalk.gray(`  并发: ${config.defaults.parallel}`));
      
      console.log('');
      console.log(chalk.bold('黑名单:'));
      if (blacklist.length > 0) {
        console.log(chalk.gray(`  共 ${blacklist.length} 个仓库`));
        blacklist.slice(0, 5).forEach(repo => {
          console.log(chalk.gray(`    - ${repo}`));
        });
        if (blacklist.length > 5) {
          console.log(chalk.gray(`    ... 还有 ${blacklist.length - 5} 个`));
        }
      } else {
        console.log(chalk.gray('  无'));
      }
      
      console.log('');
      console.log(chalk.gray(`配置文件: ${getConfigPath()}`));
      console.log(chalk.gray(`黑名单文件: ${getBlacklistPath()}`));

    } catch (error) {
      console.error(chalk.red('❌ 读取配置失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// config set - 修改配置项
configCommand
  .command('set')
  .description('修改配置项')
  .argument('<key>', '配置键 (gitlab.url, gitlab.token, defaults.directory, defaults.branch, defaults.parallel)')
  .argument('<value>', '配置值')
  .action(async (key: string, value: string) => {
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }

    try {
      const config = loadConfig();
      
      // 解析键路径
      const keys = key.split('.');
      
      if (keys.length !== 2) {
        console.error(chalk.red('❌ 无效的配置键格式'));
        console.log(chalk.yellow('支持的配置键:'));
        console.log(chalk.gray('  - gitlab.url'));
        console.log(chalk.gray('  - gitlab.token'));
        console.log(chalk.gray('  - defaults.directory'));
        console.log(chalk.gray('  - defaults.branch'));
        console.log(chalk.gray('  - defaults.parallel'));
        process.exit(1);
      }
      
      const [section, field] = keys;
      
      // 验证并设置值
      if (section === 'gitlab' && field === 'url') {
        config.gitlab.url = value;
      } else if (section === 'gitlab' && field === 'token') {
        config.gitlab.token = value;
      } else if (section === 'defaults' && field === 'directory') {
        config.defaults.directory = value;
      } else if (section === 'defaults' && field === 'branch') {
        config.defaults.branch = value;
      } else if (section === 'defaults' && field === 'parallel') {
        const parallelNum = parseInt(value);
        if (isNaN(parallelNum) || parallelNum < 1 || parallelNum > 20) {
          console.error(chalk.red('❌ 并发数必须是 1-20 之间的数字'));
          process.exit(1);
        }
        config.defaults.parallel = parallelNum;
      } else {
        console.error(chalk.red(`❌ 不支持的配置键: ${key}`));
        process.exit(1);
      }
      
      // 保存配置
      saveConfig(config);
      console.log(chalk.green(`✅ 配置已更新: ${key} = ${value}`));
      
    } catch (error) {
      console.error(chalk.red('❌ 修改配置失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// config get - 获取配置项
configCommand
  .command('get')
  .description('获取配置项')
  .argument('<key>', '配置键')
  .action((key: string) => {
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }

    try {
      const config = loadConfig();
      const keys = key.split('.');
      
      let value: any = config;
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          console.error(chalk.red(`❌ 配置键不存在: ${key}`));
          process.exit(1);
        }
      }
      
      console.log(JSON.stringify(value, null, 2));
      
    } catch (error) {
      console.error(chalk.red('❌ 读取配置失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// config add-group - 添加 Group
configCommand
  .command('add-group')
  .description('添加 GitLab Group')
  .argument('<path>', 'Group 路径 (如: dev51/fe-xh)')
  .option('-d, --description <desc>', 'Group 描述')
  .action(async (groupPath: string, options) => {
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }

    try {
      const config = loadConfig();
      
      // 检查是否已存在
      if (config.gitlab.groups.some(g => g.path === groupPath)) {
        console.error(chalk.red(`❌ Group "${groupPath}" 已存在`));
        process.exit(1);
      }
      
      // 验证 Group
      console.log(chalk.gray(`验证 Group "${groupPath}"...`));
      const gitlabService = GitLabService.fromConfig();
      const validation = await gitlabService.validateConfig(groupPath);
      
      if (!validation.valid) {
        console.error(chalk.red(`❌ Group 验证失败: ${validation.error}`));
        process.exit(1);
      }
      
      console.log(chalk.green(`✅ Group "${groupPath}" 验证成功`));
      
      // 添加 Group
      const newGroup: GitLabGroup = {
        path: groupPath,
        description: options.description
      };
      
      config.gitlab.groups.push(newGroup);
      saveConfig(config);
      
      console.log(chalk.green(`✅ Group 已添加: ${groupPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ 添加 Group 失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// config remove-group - 移除 Group
configCommand
  .command('remove-group')
  .description('移除 GitLab Group')
  .argument('<path>', 'Group 路径')
  .action(async (groupPath: string) => {
    if (!configExists()) {
      console.error(chalk.red('❌ 配置文件不存在'));
      console.log(chalk.yellow('请先运行以下命令初始化配置:'));
      console.log(chalk.cyan('  feops init'));
      process.exit(1);
    }

    try {
      const config = loadConfig();
      
      const index = config.gitlab.groups.findIndex(g => g.path === groupPath);
      if (index === -1) {
        console.error(chalk.red(`❌ Group "${groupPath}" 不存在`));
        process.exit(1);
      }
      
      // 确认删除
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `确定要移除 Group "${groupPath}" 吗?`,
          default: false
        }
      ]);
      
      if (!confirm) {
        console.log(chalk.yellow('已取消'));
        return;
      }
      
      config.gitlab.groups.splice(index, 1);
      saveConfig(config);
      
      console.log(chalk.green(`✅ Group 已移除: ${groupPath}`));
      
    } catch (error) {
      console.error(chalk.red('❌ 移除 Group 失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// config edit-blacklist - 编辑黑名单
configCommand
  .command('edit-blacklist')
  .description('在默认编辑器中打开黑名单文件')
  .action(() => {
    const { spawn } = require('child_process');
    const blacklistPath = getBlacklistPath();
    
    // 确定编辑器
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
    
    console.log(chalk.gray(`使用编辑器: ${editor}`));
    console.log(chalk.gray(`编辑文件: ${blacklistPath}`));
    
    const child = spawn(editor, [blacklistPath], {
      stdio: 'inherit'
    });
    
    child.on('exit', (code: number | null) => {
      if (code === 0) {
        console.log(chalk.green('✅ 黑名单文件已保存'));
      } else {
        console.error(chalk.red('❌ 编辑器退出异常'));
      }
    });
  });

