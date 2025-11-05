import https from 'https';
import { execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24小时检查一次
const REGISTRY_URL = 'https://registry.npmjs.org/@wangxyu%2Ffeops/latest';
const UPDATE_CHECK_FILE = path.join(os.homedir(), '.feops', 'last-update-check.json');

interface UpdateCheckData {
  lastCheck: number;
  latestVersion?: string;
  dismissed?: boolean;
}

interface PackageInfo {
  version: string;
}

/**
 * 获取 npm 包的最新版本
 */
function getLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(REGISTRY_URL, (res) => {
      // 检查状态码
      if (res.statusCode === 404) {
        reject(new Error('Package not found on npm registry. It may not be published yet.'));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: Failed to fetch package info`));
        return;
      }

      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          // 检查是否是字符串 "Not Found"
          if (data.trim() === '"Not Found"' || data.trim() === 'Not Found') {
            reject(new Error('Package not found on npm registry. It may not be published yet.'));
            return;
          }

          const packageInfo = JSON.parse(data) as PackageInfo;
          
          // 验证版本号存在且有效
          if (!packageInfo || !packageInfo.version || typeof packageInfo.version !== 'string') {
            reject(new Error('Invalid package info: version not found'));
            return;
          }

          resolve(packageInfo.version);
        } catch (error) {
          reject(new Error(`Failed to parse package info: ${(error as Error).message}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    // 设置超时
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * 比较版本号
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  // 验证输入参数
  if (!v1 || !v2 || typeof v1 !== 'string' || typeof v2 !== 'string') {
    throw new Error(`Invalid version numbers: v1=${v1}, v2=${v2}`);
  }

  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

/**
 * 读取更新检查数据
 */
function readUpdateCheckData(): UpdateCheckData {
  try {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      const data = fs.readFileSync(UPDATE_CHECK_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    // 忽略错误，返回默认值
  }

  return {
    lastCheck: 0
  };
}

/**
 * 保存更新检查数据
 */
function saveUpdateCheckData(data: UpdateCheckData): void {
  try {
    const dir = path.dirname(UPDATE_CHECK_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    // 忽略错误
  }
}

/**
 * 显示更新提示
 */
function showUpdateNotification(currentVersion: string, latestVersion: string): void {
  console.log('');
  console.log(chalk.yellow('╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.yellow('║') + '  ' + chalk.bold('🎉 发现新版本！') + '                                        ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '                                                          ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '  当前版本: ' + chalk.red(currentVersion) + '                                        ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '  最新版本: ' + chalk.green(latestVersion) + '                                        ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '                                                          ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '  运行以下命令更新:                                        ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '  ' + chalk.cyan('npm install -g @wangxyu/feops@latest') + '                     ' + chalk.yellow('║'));
  console.log(chalk.yellow('║') + '                                                          ' + chalk.yellow('║'));
  console.log(chalk.yellow('╚════════════════════════════════════════════════════════════╝'));
  console.log('');
}

/**
 * 检查是否有可用更新
 */
export async function checkForUpdates(currentVersion: string, force = false): Promise<void> {
  try {
    // 验证当前版本号
    if (!currentVersion || typeof currentVersion !== 'string') {
      if (force) {
        console.error(chalk.red('检查更新失败:'), 'Invalid current version');
      }
      return;
    }

    const checkData = readUpdateCheckData();
    const now = Date.now();

    // 如果不是强制检查，且距离上次检查时间小于间隔时间，则跳过
    if (!force && now - checkData.lastCheck < CHECK_INTERVAL) {
      // 如果之前检查到有新版本且未被忽略，显示通知
      if (checkData.latestVersion && !checkData.dismissed && 
          typeof checkData.latestVersion === 'string') {
        try {
          if (compareVersions(checkData.latestVersion, currentVersion) > 0) {
            showUpdateNotification(currentVersion, checkData.latestVersion);
          }
        } catch (error) {
          // 如果版本比较失败，忽略缓存数据
        }
      }
      return;
    }

    // 获取最新版本
    const latestVersion = await getLatestVersion();

    // 验证最新版本号
    if (!latestVersion || typeof latestVersion !== 'string') {
      if (force) {
        console.error(chalk.red('检查更新失败:'), 'Invalid latest version');
      }
      return;
    }

    // 保存检查数据
    saveUpdateCheckData({
      lastCheck: now,
      latestVersion,
      dismissed: false
    });

    // 如果有新版本，显示通知
    if (compareVersions(latestVersion, currentVersion) > 0) {
      showUpdateNotification(currentVersion, latestVersion);
    }
  } catch (error) {
    // 静默失败，不影响主程序运行
    if (force) {
      console.error(chalk.red('检查更新失败:'), (error as Error).message);
    }
  }
}

/**
 * 执行自动更新
 */
export async function performUpdate(currentVersion: string): Promise<boolean> {
  try {
    console.log(chalk.blue('正在检查更新...'));

    // 验证当前版本号
    if (!currentVersion || typeof currentVersion !== 'string') {
      throw new Error(`Invalid current version: ${currentVersion}`);
    }

    const latestVersion = await getLatestVersion();

    // 验证最新版本号
    if (!latestVersion || typeof latestVersion !== 'string') {
      throw new Error(`Invalid latest version: ${latestVersion}`);
    }

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      console.log(chalk.green('✓ 已是最新版本 ' + currentVersion));
      return true;
    }

    console.log(chalk.yellow(`发现新版本: ${currentVersion} → ${latestVersion}`));
    console.log(chalk.blue('正在更新...'));

    // 执行 npm 更新命令
    execSync('npm install -g @wangxyu/feops@latest', {
      stdio: 'inherit',
      encoding: 'utf-8'
    });

    console.log(chalk.green('✓ 更新成功！'));
    console.log(chalk.gray('请重新运行命令以使用新版本'));
    
    return true;
  } catch (error) {
    console.error(chalk.red('✗ 更新失败:'), (error as Error).message);
    console.log(chalk.yellow('请手动执行: npm install -g @wangxyu/feops@latest'));
    return false;
  }
}

/**
 * 获取当前安装的版本信息
 */
export function getCurrentVersionInfo(): { isGlobal: boolean; version: string } {
  try {
    // 检查是否全局安装
    const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const currentPath = __dirname;
    const isGlobal = currentPath.includes(globalPath);

    return {
      isGlobal,
      version: require('../../package.json').version
    };
  } catch (error) {
    return {
      isGlobal: false,
      version: require('../../package.json').version
    };
  }
}

