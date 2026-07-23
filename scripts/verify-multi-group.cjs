#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const {
  resolveGroupDirectory,
  resolveRepoLocalPath,
  getAllGroupDirectories,
  resolveScanDirectories,
  scanAllGitProjects,
  findGroupByPath
} = require('../dist/utils/directories');

const projectRoot = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${message}`);
    return;
  }

  failed += 1;
  console.error(`✗ ${message}`);
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, actual: ${actual})`);
}

const defaults = {
  directory: '../repos',
  branch: 'master',
  parallel: 3
};

const newConfig = {
  gitlab: {
    url: 'http://gitlab.example.com',
    token: 'test-token',
    groups: [
      { path: 'my-org/frontend', description: 'frontend' },
      { path: 'my-org/mobile', description: 'mobile' }
    ]
  },
  blacklist: [],
  defaults: {
    directory: '.',
    branch: 'master',
    parallel: 3
  }
};

console.log('=== 单元测试: 目录解析 ===\n');

assertEqual(
  resolveGroupDirectory({ path: 'my-org/frontend' }, defaults),
  path.resolve(defaults.directory, 'my-org/frontend'),
  '相对 path 拼接到 defaults.directory'
);

assertEqual(
  resolveGroupDirectory({ path: '/abs/group-a' }, defaults),
  path.resolve('/abs/group-a'),
  '绝对 path 直接使用自身路径'
);

assertEqual(
  resolveRepoLocalPath({ path: 'my-org/frontend' }, 'my-app', defaults),
  path.resolve(defaults.directory, 'my-org/frontend/my-app'),
  'repo 路径 = defaults.directory/group.path/repo-name'
);

assertEqual(
  resolveRepoLocalPath({ path: 'my-org/frontend' }, 'my-app', defaults, '/tmp/custom'),
  path.resolve('/tmp/custom/my-org/frontend/my-app'),
  'sync -d 覆盖相对 path 的本地根目录'
);

assertEqual(
  resolveRepoLocalPath({ path: '/abs/group-a' }, 'my-app', defaults, '/tmp/custom'),
  path.resolve('/abs/group-a/my-app'),
  'sync -d 不影响绝对 group.path'
);

// 旧配置中的 directory 字段应被忽略（解析只看 path）
assertEqual(
  resolveGroupDirectory({ path: 'my-org/frontend', directory: '/ignored' }, defaults),
  path.resolve(defaults.directory, 'my-org/frontend'),
  '忽略已废弃的 group.directory 字段'
);

const allDirs = getAllGroupDirectories(newConfig).sort();
assertEqual(
  JSON.stringify(allDirs),
  JSON.stringify([
    path.resolve(newConfig.defaults.directory, 'my-org/frontend'),
    path.resolve(newConfig.defaults.directory, 'my-org/mobile')
  ].sort()),
  'getAllGroupDirectories 返回所有 group 目录'
);

assertEqual(
  getAllGroupDirectories(newConfig, { groupPath: 'my-org/mobile' }).length,
  1,
  'getAllGroupDirectories 支持 group 过滤'
);

assertEqual(
  resolveScanDirectories(newConfig).length,
  2,
  'resolveScanDirectories 无 -d 时扫描所有 group 目录'
);

assertEqual(
  resolveScanDirectories(newConfig, { directory: '/tmp/only-one' })[0],
  path.resolve('/tmp/only-one'),
  'resolveScanDirectories -d 时仅扫描指定目录'
);

assert(
  Boolean(findGroupByPath(newConfig, 'my-org/frontend')),
  'findGroupByPath 可找到 group 配置'
);

console.log('\n=== 集成测试: 多目录扫描 ===\n');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feops-multi-group-'));
const fakeHome = path.join(tmpRoot, 'home');
const workDir = path.join(tmpRoot, 'workspace');

fs.mkdirSync(path.join(fakeHome, '.feops'), { recursive: true });
fs.mkdirSync(workDir, { recursive: true });

function createFakeRepo(groupDir, repoName) {
  const repoPath = path.join(workDir, groupDir, repoName);
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  return repoPath;
}

createFakeRepo('my-org/frontend', 'repo-a');
createFakeRepo('my-org/mobile', 'repo-b');

const integrationConfig = JSON.parse(JSON.stringify(newConfig));
fs.writeFileSync(
  path.join(fakeHome, '.feops/config.json'),
  JSON.stringify(integrationConfig, null, 2)
);

process.chdir(workDir);

const scannedProjects = scanAllGitProjects(integrationConfig);
assertEqual(scannedProjects.length, 2, 'scanAllGitProjects 扫描两个 group 目录');
assert(
  scannedProjects.some(project => project.name === 'repo-a' && project.path.endsWith(`${path.sep}my-org${path.sep}frontend${path.sep}repo-a`)),
  'scanAllGitProjects 找到 my-org/frontend/repo-a'
);
assert(
  scannedProjects.some(project => project.name === 'repo-b' && project.path.endsWith(`${path.sep}my-org${path.sep}mobile${path.sep}repo-b`)),
  'scanAllGitProjects 找到 my-org/mobile/repo-b'
);

const filteredProjects = scanAllGitProjects(integrationConfig, { group: 'my-org/mobile' });
assertEqual(filteredProjects.length, 1, 'scanAllGitProjects --group 仅扫描指定 group');
assertEqual(filteredProjects[0]?.name, 'repo-b', 'scanAllGitProjects --group 返回正确项目');

console.log('\n=== CLI 集成测试: config list / branch ===\n');

const feopsBin = path.join(projectRoot, 'dist/index.js');
const cliEnv = { ...process.env, HOME: fakeHome };

try {
  const configListOutput = execSync(`node "${feopsBin}" config list`, {
    cwd: workDir,
    env: cliEnv,
    encoding: 'utf8'
  });

  // 用 endsWith 片段匹配，避免 macOS /var vs /private/var 符号链接差异
  assert(
    /my-org\/frontend → .+\/my-org\/frontend/.test(configListOutput),
    'config list 显示 group 本地目录'
  );
  assert(
    /my-org\/mobile → .+\/my-org\/mobile/.test(configListOutput),
    'config list 显示第二个 group 本地目录'
  );
} catch (error) {
  failed += 1;
  console.error('✗ config list CLI 测试失败');
  console.error(error.stdout?.toString?.() || error.message);
}

try {
  const branchOutput = execSync(`node "${feopsBin}" branch master --no-fetch --format simple`, {
    cwd: workDir,
    env: cliEnv,
    encoding: 'utf8'
  });

  assert(
    branchOutput.includes('找到 2 个 Git 项目') || branchOutput.includes('总项目数: 2'),
    'branch CLI 扫描多个 group 目录'
  );
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`;
  if (output.includes('找到 2 个 Git 项目') || output.includes('总项目数: 2')) {
    passed += 1;
    console.log('✓ branch CLI 扫描多个 group 目录');
  } else {
    failed += 1;
    console.error('✗ branch CLI 测试失败');
    console.error(output || error.message);
  }
}

console.log('\n=== 清理 ===');
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n测试结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
