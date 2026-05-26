# @wangxyu/feops [GitHub](https://github.com/workwsl/feops)

前端运维工具集 - 基于 Node.js 实现的前端运维工具，主要用于批量管理和同步前端仓库。

## 功能特性

- 🔧 **配置管理** - 在用户目录下管理配置，支持多个 GitLab Group
- 🔗 **GitLab API 集成** - 自动从 GitLab API 获取仓库列表
- 🚀 **智能同步** - 自动判断克隆新仓库或更新已存在仓库
- 🎯 **智能过滤** - 支持黑名单功能，灵活过滤仓库
- 📊 **进度显示** - 实时显示处理进度和统计信息
- ⚡ **高性能** - 可配置并发数量，提高处理效率
- 🛡️ **错误处理** - 完善的错误处理和重试机制
- 🔍 **分支管理** - 查找分支、检查合并状态、验证代码更新
- 🔄 **自动更新** - 自动检查并更新到最新版本

## 安装

### 全局安装（推荐）
```bash
npm install -g @wangxyu/feops
```

### 本地开发
```bash
npm install
npm run build
```

## 快速开始

### 1. 初始化配置
首次使用需要初始化配置：
```bash
feops init
```

该命令会引导你完成以下配置：
- GitLab 服务器地址
- GitLab Access Token
- GitLab Group 路径（支持多个，每个 Group 可配置独立本地目录）
- 默认克隆目录（未配置 group.directory 时的 fallback）
- 默认分支名称
- 默认并发数

配置文件将保存在 `~/.feops/config.json`

### 2. 同步仓库
```bash
# 克隆或更新所有配置的仓库
feops sync

# 仅同步指定 Group
feops sync --group dev51/fe-xh

# 预览模式，查看将要执行的操作
feops sync --dry-run
```

### 3. 查看配置
```bash
# 查看当前配置
feops config list

# 查看完整的 Token
feops config list --show-token
```

## 核心命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `init` | 初始化配置 | `feops init` |
| `config` | 配置管理 | `feops config list` |
| `sync` | 同步仓库 | `feops sync` |
| `list` | 列出仓库 | `feops list` |
| `branch` | 查找分支 | `feops branch main` |
| `merged` | 检查已合并 | `feops merged feature/auth` |
| `uptodate` | 检查最新代码 | `feops uptodate dev` |
| `upgrade` | 更新工具 | `feops upgrade` |

## 常见使用场景

### 场景 1: 新电脑初始化
```bash
# 1. 全局安装
npm install -g @wangxyu/feops

# 2. 初始化配置
feops init

# 3. 克隆所有仓库
feops sync

# 4. 查看仓库列表
feops list
```

### 场景 2: 日常代码同步
```bash
# 更新所有仓库到最新代码
feops sync

# 查看哪些项目有 feature/new-ui 分支
feops branch feature/new-ui --remote
```

### 场景 3: 功能分支管理
```bash
# 1. 查找包含该分支的项目
feops branch feature/auth --remote

# 2. 检查是否已合并到 master
feops merged feature/auth

# 3. 检查是否包含最新 master 代码
feops uptodate feature/auth
```

### 场景 4: 发布前检查
```bash
# 1. 同步所有代码
feops sync

# 2. 检查功能分支是否已合并
feops merged feature/payment --base-branch release

# 3. 检查 release 是否包含最新 master
feops uptodate release
```

## 配置管理

### 查看和修改配置
```bash
# 查看配置
feops config list

# 修改配置
feops config set gitlab.url http://your-gitlab.com
feops config set defaults.directory ../my-repos
feops config set defaults.branch main
```

### 管理 Group
```bash
# 添加 Group（本地目录默认等于 Group 路径）
feops config add-group dev51/fe-xh -d "前端仓库组"

# 添加 Group 并指定本地目录
feops config add-group dev51/xbb -D dev51/xbb -d "xbb 仓库组"

# 移除 Group
feops config remove-group dev51/fe-xh
```

### 编辑黑名单
```bash
# 在编辑器中打开黑名单文件
feops config edit-blacklist

# 或直接编辑文件
vim ~/.feops/blacklist.txt
```

## 配置文件

### 配置文件位置
- 配置文件: `~/.feops/config.json`
- 黑名单文件: `~/.feops/blacklist.txt`

### 配置文件格式
```json
{
  "gitlab": {
    "url": "http://gitcode.example.com",
    "token": "your-gitlab-token",
    "groups": [
      {
        "path": "dev51/fe-xh",
        "directory": "dev51/fe-xh",
        "description": "前端 xh 组"
      },
      {
        "path": "dev51/xbb",
        "directory": "dev51/xbb",
        "description": "xbb 组"
      }
    ]
  },
  "blacklist": [],
  "defaults": {
    "directory": ".",
    "branch": "master",
    "parallel": 3
  }
}
```

### 多 Group 目录结构

每个 Group 可配置独立的 `directory`，sync 后目录结构如下：

```
dev51/fe-xh/<repo-name>/
dev51/xbb/<repo-name>/
```

**兼容说明：**
- 旧配置中 group 未设置 `directory` 时，该 group 的仓库仍写入 `defaults.directory/<repo-name>`
- `sync -d` 仅覆盖未配置 `group.directory` 的旧 group
- `branch` / `merged` / `uptodate` 未指定 `-d` 时，会自动扫描所有 group 目录

### 黑名单文件格式
```
# 黑名单配置文件
# 以 # 开头的行为注释，会被忽略
# 每行一个仓库名称

fe-unwanted-repo1
fe-unwanted-repo2
fe-archived-project
```

## 获取 GitLab Access Token

1. 登录 GitLab
2. 进入 **Settings** > **Access Tokens**
3. 创建新 Token，权限选择：
   - `read_api` - 读取 API
   - `read_repository` - 读取仓库
4. 复制生成的 Token，在 `feops init` 时使用

## 项目结构

```
feops/
├── src/
│   ├── index.ts            # CLI 入口文件
│   ├── config/             # 配置管理
│   │   └── index.ts
│   ├── services/           # 服务层
│   │   └── gitlab.ts       # GitLab API 服务
│   ├── commands/           # 命令实现
│   │   ├── init.ts         # 初始化命令
│   │   ├── config.ts       # 配置管理命令
│   │   ├── sync.ts         # 同步仓库命令
│   │   ├── list.ts         # 仓库列表命令
│   │   ├── branch.ts       # 分支查找命令
│   │   ├── merged.ts       # 合并检查命令
│   │   └── uptodate.ts     # 最新代码检查命令
│   └── utils/              # 工具函数
│       ├── index.ts
│       ├── directories.ts  # 多 Group 目录解析
│       └── progressBar.ts
├── dist/                   # 编译输出
├── docs/                   # 文档
│   ├── commands.md         # 命令详细参考
│   └── quick-reference.md  # 快速参考
├── package.json
├── tsconfig.json
└── README.md
```

## 开发

### 安装依赖
```bash
npm install
```

### 开发模式
```bash
npm run dev
```

### 构建
```bash
npm run build
```

### 测试
```bash
# 使用编译后的版本
node dist/index.js --help

# 或使用 npm link 全局链接
npm link
feops --help
```

## 自动更新

feops 支持自动检查更新，每 24 小时检查一次。

### 手动检查更新
```bash
# 检查是否有新版本
feops upgrade --check

# 直接更新到最新版本
feops upgrade
```

### 自动检查
- 每次运行命令时，工具会在后台检查更新（不阻塞主程序）
- 如果发现新版本，会在命令输出前显示更新提示
- 检查结果会缓存 24 小时，避免频繁请求

## 文档

本项目采用单文档结构：本页即包含快速上手、快速参考以及完整命令参考。

---

## 命令详细参考

### 命令概览

feops 提供简洁明了的命令名称，每个命令都直接表达其功能。

| 命令 | 说明 | 示例 |
|------|------|------|
| `init` | 初始化配置 | `feops init` |
| `config` | 配置管理 | `feops config list` |
| `sync` | 同步仓库 | `feops sync` |
| `list` | 列出仓库 | `feops list` |
| `branch` | 查找分支 | `feops branch main` |
| `merged` | 检查已合并 | `feops merged feature/auth` |
| `uptodate` | 检查最新代码 | `feops uptodate dev` |
| `upgrade` | 更新工具 | `feops upgrade` |

### init - 初始化配置

交互式初始化配置向导，首次使用时必须运行。

#### 用法
```bash
feops init [options]
```

#### 选项
- `--force` - 强制重新初始化，覆盖现有配置

#### 示例
```bash
# 初始化配置
feops init

# 强制重新初始化
feops init --force
```

#### 配置项说明
- GitLab URL, Access Token, Group Path, Group Directory, Default Directory (fallback), Default Branch, Parallel

### config - 配置管理

管理 feops 配置，包括查看、修改配置和管理 Group。

#### 子命令要点
- `config list [--show-token]`
- `config set <key> <value>`（支持 gitlab.url/gitlab.token/defaults.*）
- `config get <key>`
- `config add-group <path> [-d desc] [-D directory]`
- `config remove-group <path>`
- `config edit-blacklist`

### sync - 同步仓库

智能判断仓库状态，自动克隆新仓库或更新已存在的仓库。

#### 用法
```bash
feops sync [options]
```

#### 常用选项
- `-d, --directory <dir>` 目标目录（仅覆盖未配置 group.directory 的旧 group）
- `-g, --group <path>` 仅同步指定 Group
- `-b, --blacklist <repos...>` 临时黑名单
- `--dry-run` 预览
- `-p, --parallel <n>` 并发数
- `--git-url-base <url>`、`--branch <branch>` 覆盖配置

### list - 列出仓库

```bash
feops list [--filter <p>] [--visibility <t>] [--format <type>] [...]
```

### branch - 查找分支

```bash
feops branch <name> [-d <dir>] [-g <group>] [--remote] [--no-fetch] [--format <type>] [-p <n>]
```

### merged - 检查合并状态

```bash
feops merged <branch> [-d <dir>] [-g <group>] [--base-branch <branch>] [--show-missing] [--no-fetch] [--format <type>] [-p <n>]
```

### uptodate - 检查是否最新

```bash
feops uptodate <branch> [-d <dir>] [-g <group>] [--base-branch <branch>] [--show-missing] [--no-fetch] [--format <type>] [-p <n>]
```

### upgrade - 检查和更新工具

```bash
feops upgrade [--check]
```

> 提示：`upgrade` 用于更新工具本身；`uptodate` 用于检查分支是否包含最新代码。

### merged vs uptodate 的区别

- merged：检查 分支 → master 是否已合并
- uptodate：检查 master → 分支 是否最新

### 输出格式

大部分命令支持三种输出格式：`table`（默认）、`simple`、`json`。

### 性能优化

- 并发：`-p 5~10`
- 跳过网络：`--no-fetch`（刚执行过 sync、网络不稳定、仅看本地状态）

### CI/CD 集成

```bash
feops merged ${BRANCH_NAME} --format json --no-fetch
feops list --format json | jq '...'
```

### 常用组合

```bash
feops sync && feops merged feature/auth
feops branch feature/auth && feops merged feature/auth
```

### 帮助信息

```bash
feops --help
feops sync --help
feops branch --help
feops merged --help
feops uptodate --help
feops upgrade --help
```

## 更新日志

详细的更新日志请查看 [CHANGELOG.md](./CHANGELOG.md)

### v1.1.0 (2026-05-26)

#### 新增
- ✨ 支持多 Group 独立本地目录配置
- ✨ `sync` / `branch` / `merged` / `uptodate` 新增 `--group` 选项

#### 改进
- 🔄 旧配置兼容：未设置 `group.directory` 时仍使用 `defaults.directory`

### v1.0.1 (2025-11-21)

#### 新增
- ✨ `sync` 命令：添加未提交更改检查功能
- ✨ `sync` 命令：跳过有未提交更改的仓库，并以表格形式展示

#### 改进
- 🔄 文档：合并所有文档到 README.md，采用单文档结构
- 🔄 `sync` 命令：优化结果展示，使用表格展示跳过的仓库信息

#### 修复
- 🐛 `sync` 命令：修复分支切换时的错误处理

### v1.0.0 (2025-11-05)

#### 初始版本
- 🎉 首次发布
- ✨ 完整的 Git 仓库管理功能
- ✨ GitLab API 集成
- ✨ 自动更新检查

## 许可证

ISC License
