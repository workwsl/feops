import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * GitLab Group 配置
 */
export interface GitLabGroup {
  path: string;
  description?: string;
}

/**
 * 配置接口
 */
export interface Config {
  gitlab: {
    url: string;
    token: string;
    groups: GitLabGroup[];
  };
  blacklist: string[];
  defaults: {
    directory: string;
    branch: string;
    parallel: number;
  };
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Config = {
  gitlab: {
    url: '',
    token: '',
    groups: []
  },
  blacklist: [],
  defaults: {
    directory: '../fe-xh',
    branch: 'master',
    parallel: 5
  }
};

/**
 * 获取配置目录路径
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.feops');
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * 获取黑名单文件路径
 */
export function getBlacklistPath(): string {
  return path.join(getConfigDir(), 'blacklist.txt');
}

/**
 * 确保配置目录存在
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * 检查配置文件是否存在
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * 加载配置文件
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}\n请先运行 'feops init' 初始化配置`);
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    
    // 合并默认配置,确保所有字段都存在
    return {
      ...DEFAULT_CONFIG,
      ...config,
      gitlab: {
        ...DEFAULT_CONFIG.gitlab,
        ...config.gitlab
      },
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...config.defaults
      }
    };
  } catch (error) {
    throw new Error(`读取配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 保存配置文件
 */
export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  
  try {
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, content, 'utf8');
  } catch (error) {
    throw new Error(`保存配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 加载黑名单
 */
export function loadBlacklist(): string[] {
  const blacklistPath = getBlacklistPath();
  
  if (!fs.existsSync(blacklistPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(blacklistPath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    console.warn(`读取黑名单文件失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 保存黑名单
 */
export function saveBlacklist(blacklist: string[]): void {
  ensureConfigDir();
  const blacklistPath = getBlacklistPath();
  
  try {
    const content = [
      '# 黑名单配置文件',
      '# 以 # 开头的行为注释,会被忽略',
      '# 每行一个仓库名称',
      '',
      ...blacklist
    ].join('\n');
    
    fs.writeFileSync(blacklistPath, content, 'utf8');
  } catch (error) {
    throw new Error(`保存黑名单文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取默认配置
 */
export function getDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

