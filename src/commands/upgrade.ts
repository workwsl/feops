import { Command } from 'commander';
import chalk from 'chalk';
import { performUpdate, checkForUpdates, getCurrentVersionInfo } from '../utils/updateChecker';
import { version } from '../../package.json';

export const upgradeCommand = new Command('upgrade')
  .description('检查并更新 feops 到最新版本')
  .option('--check', '仅检查是否有更新，不执行更新')
  .action(async (options) => {
    try {
      const { isGlobal, version: currentVersion } = getCurrentVersionInfo();

      console.log(chalk.blue('feops 更新工具'));
      console.log(chalk.gray(`当前版本: ${currentVersion}`));
      console.log('');

      // 如果不是全局安装，给出提示
      if (!isGlobal) {
        console.log(chalk.yellow('⚠️  检测到 feops 不是全局安装'));
        console.log(chalk.gray('建议使用全局安装以获得更好的体验:'));
        console.log(chalk.cyan('  npm install -g @wangxyu/feops'));
        console.log('');
      }

      if (options.check) {
        // 仅检查更新
        await checkForUpdates(currentVersion, true);
      } else {
        // 执行更新
        const success = await performUpdate(currentVersion);
        if (success) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      
      // 检查是否是包未发布的错误
      if (errorMessage.includes('not found') || errorMessage.includes('not published')) {
        console.log(chalk.yellow('⚠️  包尚未发布到 npm registry'));
        console.log(chalk.gray('这是正常的，如果您正在开发中或包还未发布。'));
        console.log(chalk.gray('您可以使用以下命令手动安装最新版本：'));
        console.log(chalk.cyan('  npm install -g @wangxyu/feops@latest'));
      } else {
        console.error(chalk.red('更新过程中发生错误:'), errorMessage);
      }
      process.exit(1);
    }
  });

