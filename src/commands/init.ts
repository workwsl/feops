import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'fs';
import {
  getConfigDir,
  getConfigPath,
  getBlacklistPath,
  configExists,
  saveConfig,
  saveBlacklist,
  Config,
  GitLabGroup
} from '../config';
import { GitLabService } from '../services/gitlab';

export const initCommand = new Command('init')
  .description('初始化 feops 配置')
  .option('-f, --force', '强制重新初始化,覆盖现有配置')
  .action(async (options) => {
    console.log(chalk.cyan('🚀 feops 配置初始化向导\n'));

    // 检查配置是否已存在
    if (configExists() && !options.force) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: '配置文件已存在,是否覆盖?',
          default: false
        }
      ]);

      if (!overwrite) {
        console.log(chalk.yellow('已取消初始化'));
        return;
      }
    }

    try {
      // 收集配置信息
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'gitlabUrl',
          message: 'GitLab 服务器地址:',
          default: 'http://gitcode.tongdao.cn',
          validate: (input: string) => {
            if (!input.trim()) {
              return '请输入 GitLab 服务器地址';
            }
            try {
              new URL(input);
              return true;
            } catch {
              return '请输入有效的 URL';
            }
          }
        },
        {
          type: 'password',
          name: 'gitlabToken',
          message: 'GitLab Access Token:',
          validate: (input: string) => {
            if (!input.trim()) {
              return '请输入 GitLab Access Token';
            }
            return true;
          }
        }
      ]);

      // 验证 Token
      console.log(chalk.gray('\n验证 Token...'));
      const gitlabService = new GitLabService(answers.gitlabUrl, answers.gitlabToken);

      // 收集 Group 配置
      const groups: GitLabGroup[] = [];
      let addMore = true;

      while (addMore) {
        const groupAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'groupPath',
            message: `GitLab Group 路径 ${groups.length > 0 ? '(留空跳过)' : ''}:`,
            validate: (input: string) => {
              if (groups.length === 0 && !input.trim()) {
                return '至少需要添加一个 Group';
              }
              return true;
            }
          }
        ]);

        if (!groupAnswers.groupPath.trim()) {
          break;
        }

        // 验证 Group
        console.log(chalk.gray(`验证 Group "${groupAnswers.groupPath}"...`));
        const validation = await gitlabService.validateConfig(groupAnswers.groupPath);

        if (!validation.valid) {
          console.log(chalk.red(`❌ Group 验证失败: ${validation.error}`));
          const { retry } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'retry',
              message: '是否重新输入?',
              default: true
            }
          ]);

          if (retry) {
            continue;
          } else {
            break;
          }
        }

        console.log(chalk.green(`✅ Group "${groupAnswers.groupPath}" 验证成功`));

        const { description } = await inquirer.prompt([
          {
            type: 'input',
            name: 'description',
            message: 'Group 描述 (可选):',
            default: ''
          }
        ]);

        groups.push({
          path: groupAnswers.groupPath,
          description: description || undefined
        });

        if (groups.length > 0) {
          const { continueAdding } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'continueAdding',
              message: '是否继续添加其他 Group?',
              default: false
            }
          ]);

          addMore = continueAdding;
        }
      }

      if (groups.length === 0) {
        console.log(chalk.red('❌ 至少需要配置一个 Group'));
        process.exit(1);
      }

      // 收集默认配置
      const directoryAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'directory',
          message: '默认克隆目录:',
          default: '../fe-xh'
        }
      ]);
      
      const branchAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'branch',
          message: '默认分支名称:',
          default: 'master'
        }
      ]);
      
      const parallelAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'parallel',
          message: '默认并发数:',
          default: '3',
          validate: (input: string) => {
            const num = parseInt(input);
            if (isNaN(num) || num < 1 || num > 20) {
              return '并发数应在 1-20 之间';
            }
            return true;
          }
        }
      ]);
      
      const defaultsAnswers = {
        directory: directoryAnswer.directory,
        branch: branchAnswer.branch,
        parallel: parseInt(parallelAnswer.parallel)
      };

      // 构建配置对象
      const config: Config = {
        gitlab: {
          url: answers.gitlabUrl,
          token: answers.gitlabToken,
          groups: groups
        },
        blacklist: [],
        defaults: {
          directory: defaultsAnswers.directory,
          branch: defaultsAnswers.branch,
          parallel: defaultsAnswers.parallel
        }
      };

      // 保存配置
      console.log(chalk.gray('\n保存配置...'));
      saveConfig(config);
      console.log(chalk.green(`✅ 配置已保存到: ${getConfigPath()}`));

      // 创建空的黑名单文件
      if (!fs.existsSync(getBlacklistPath())) {
        saveBlacklist([]);
        console.log(chalk.green(`✅ 黑名单文件已创建: ${getBlacklistPath()}`));
      }

      // 显示配置摘要
      console.log(chalk.cyan('\n📋 配置摘要:'));
      console.log(chalk.gray(`  GitLab URL: ${config.gitlab.url}`));
      console.log(chalk.gray(`  配置的 Groups: ${config.gitlab.groups.length} 个`));
      config.gitlab.groups.forEach((group, index) => {
        console.log(chalk.gray(`    ${index + 1}. ${group.path}${group.description ? ` - ${group.description}` : ''}`));
      });
      console.log(chalk.gray(`  默认目录: ${config.defaults.directory}`));
      console.log(chalk.gray(`  默认分支: ${config.defaults.branch}`));
      console.log(chalk.gray(`  默认并发: ${config.defaults.parallel}`));

      console.log(chalk.cyan('\n✨ 初始化完成!'));
      console.log(chalk.gray('\n下一步:'));
      console.log(chalk.gray('  1. 编辑黑名单文件 (可选):'));
      console.log(chalk.gray(`     ${getBlacklistPath()}`));
      console.log(chalk.gray('  2. 运行命令:'));
      console.log(chalk.gray('     feops sync                 # 同步仓库'));
      console.log(chalk.gray('     feops list               # 列出所有仓库'));
      console.log(chalk.gray('     feops config list        # 查看配置'));

    } catch (error) {
      console.error(chalk.red('\n❌ 初始化失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

