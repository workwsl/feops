import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * 检查文件是否存在
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * 创建目录（如果不存在）
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 读取 JSON 文件
 */
export function readJsonFile(filePath: string): any {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(chalk.red(`Error reading JSON file ${filePath}:`), error);
    return null;
  }
}

/**
 * 写入 JSON 文件
 */
export function writeJsonFile(filePath: string, data: any): void {
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    console.error(chalk.red(`Error writing JSON file ${filePath}:`), error);
  }
}

/**
 * 写入文件
 */
export function writeFile(filePath: string, content: string): void {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    console.error(chalk.red(`Error writing file ${filePath}:`), error);
  }
}

/**
 * 复制文件
 */
export function copyFile(src: string, dest: string): void {
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  } catch (error) {
    console.error(chalk.red(`Error copying file from ${src} to ${dest}:`), error);
  }
}

/**
 * 获取项目根目录
 */
export function getProjectRoot(): string {
  let currentDir = process.cwd();
  
  while (currentDir !== path.dirname(currentDir)) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  return process.cwd();
}

/**
 * 检查是否在项目目录中
 */
export function isInProject(): boolean {
  return fileExists(path.join(process.cwd(), 'package.json'));
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(1);
  
  return `${size} ${sizes[i]}`;
}

/**
 * 格式化时间
 */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * 显示加载动画
 */
export function showSpinner(message: string): () => void {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  const interval = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(frames[i])} ${message}`);
    i = (i + 1) % frames.length;
  }, 100);
  
  return () => {
    clearInterval(interval);
    process.stdout.write('\r');
  };
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 验证项目名称
 */
export function validateProjectName(name: string): boolean {
  const validNameRegex = /^[a-z0-9-_]+$/;
  return validNameRegex.test(name) && name.length > 0 && name.length <= 50;
}

/**
 * 获取包管理器类型
 */
export function getPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  if (fileExists('yarn.lock')) return 'yarn';
  if (fileExists('pnpm-lock.yaml')) return 'pnpm';
  return 'npm';
}