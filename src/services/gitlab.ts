import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { loadConfig } from '../config';

/**
 * GitLab 项目接口
 */
export interface GitLabProject {
  id: number;
  name: string;
  description: string;
  path_with_namespace: string;
  web_url: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  visibility: string;
  archived: boolean;
  created_at: string;
  last_activity_at: string;
}

/**
 * 仓库接口 (与现有命令兼容)
 */
export interface Repository {
  id: number;
  name: string;
  description: string;
  relative_path: string;
  full_name: string;
  visibility: string;
  archived: boolean;
}

/**
 * GitLab API 服务类
 */
export class GitLabService {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾的斜杠
    this.token = token;
  }

  /**
   * 从配置创建 GitLabService 实例
   */
  static fromConfig(): GitLabService {
    const config = loadConfig();
    return new GitLabService(config.gitlab.url, config.gitlab.token);
  }

  /**
   * 发送 HTTP 请求
   */
  private async request(endpoint: string): Promise<any> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Content-Type': 'application/json'
        }
      };

      const req = httpModule.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error(`解析响应失败: ${error instanceof Error ? error.message : String(error)}`));
            }
          } else {
            reject(new Error(`请求失败: ${res.statusCode} ${res.statusMessage}\n${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`网络请求失败: ${error.message}`));
      });

      req.end();
    });
  }

  /**
   * 获取 Group 信息
   */
  async getGroup(groupPath: string): Promise<any> {
    const encodedPath = encodeURIComponent(groupPath);
    return this.request(`/api/v4/groups/${encodedPath}`);
  }

  /**
   * 获取指定 Group 下的所有项目 (包含子组)
   */
  async fetchProjects(groupPath: string): Promise<Repository[]> {
    const encodedPath = encodeURIComponent(groupPath);
    const allProjects: GitLabProject[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const endpoint = `/api/v4/groups/${encodedPath}/projects?include_subgroups=true&per_page=${perPage}&page=${page}`;
      
      try {
        const projects: GitLabProject[] = await this.request(endpoint);
        
        if (projects.length === 0) {
          break;
        }
        
        allProjects.push(...projects);
        
        // 如果返回的项目数少于每页数量,说明已经是最后一页
        if (projects.length < perPage) {
          break;
        }
        
        page++;
      } catch (error) {
        throw new Error(`获取 Group "${groupPath}" 的项目失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 转换为 Repository 格式
    return allProjects.map(project => this.convertToRepository(project));
  }

  /**
   * 获取配置中所有 Group 的项目
   */
  async fetchAllConfiguredProjects(): Promise<Repository[]> {
    const config = loadConfig();
    const allRepositories: Repository[] = [];
    const errors: string[] = [];

    for (const group of config.gitlab.groups) {
      try {
        const repos = await this.fetchProjects(group.path);
        allRepositories.push(...repos);
      } catch (error) {
        errors.push(`Group "${group.path}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0 && allRepositories.length === 0) {
      throw new Error(`获取所有 Group 的项目都失败了:\n${errors.join('\n')}`);
    }

    if (errors.length > 0) {
      console.warn(`部分 Group 获取失败:\n${errors.join('\n')}`);
    }

    // 去重 (根据 id)
    const uniqueRepos = Array.from(
      new Map(allRepositories.map(repo => [repo.id, repo])).values()
    );

    return uniqueRepos;
  }

  /**
   * 验证 Token 和 Group 是否有效
   */
  async validateConfig(groupPath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.getGroup(groupPath);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 转换 GitLab 项目为 Repository 格式
   */
  private convertToRepository(project: GitLabProject): Repository {
    // 从 http_url_to_repo 中提取 relative_path
    // 例如: http://gitcode.tongdao.cn/dev51/fe-xh/fe-xxrlwx2c-mp.git
    // 提取: /dev51/fe-xh/fe-xxrlwx2c-mp
    let relativePath = project.path_with_namespace;
    if (relativePath && !relativePath.startsWith('/')) {
      relativePath = '/' + relativePath;
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description || '',
      relative_path: relativePath,
      full_name: project.path_with_namespace,
      visibility: project.visibility,
      archived: project.archived
    };
  }
}

