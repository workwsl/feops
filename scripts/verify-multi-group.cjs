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
  directory: '../fe-xh',
  branch: 'master',
  parallel: 3
};

const newConfig = {
  gitlab: {
    url: 'http://gitcode.example.com',
    token: 'test-token',
    groups: [
      { path: 'dev51/fe-xh', directory: 'dev51/fe-xh', description: 'xh' },
      { path: 'dev51/xbb', directory: 'dev51/xbb', description: 'xbb' }
    ]
  },
  blacklist: [],
  defaults: {
    directory: '.',
    branch: 'master',
    parallel: 3
  }
};

const legacyConfig = {
  gitlab: {
    url: 'http://gitcode.example.com',
    token: 'test-token',
    groups: [{ path: 'dev51/fe-xh', description: 'legacy' }]
  },
  blacklist: [],
  defaults
};

console.log('=== 单元测试: 目录解析 ===\n');

assertEqual(
  resolveGroupDirectory({ path: 'dev51/fe-xh', directory: 'dev51/fe-xh' }, defaults),
  path.resolve('dev51/fe-xh'),
  '新配置 group 使用 group.directory'
);

assertEqual(
  resolveGroupDirectory({ path: 'dev51/fe-xh' }, defaults),
  path.resolve('../fe-xh'),
  '旧配置 group 使用 defaults.directory'
);

assertEqual(
  resolveRepoLocalPath({ path: 'dev51/fe-xh', directory: 'dev51/fe-xh' }, 'my-app', defaults),
  path.resolve('dev51/fe-xh/my-app'),
  '新配置 repo 路径 = directory/repo-name'
);

assertEqual(
  resolveRepoLocalPath({ path: 'dev51/fe-xh' }, 'my-app', defaults),
  path.resolve('../fe-xh/my-app'),
  '旧配置 repo 路径 = defaults.directory/repo-name'
);

assertEqual(
  resolveRepoLocalPath({ path: 'dev51/fe-xh' }, 'my-app', defaults, '/tmp/custom'),
  path.resolve('/tmp/custom/my-app'),
  'sync -d 仅覆盖未配置 directory 的旧 group'
);

assertEqual(
  resolveRepoLocalPath({ path: 'dev51/fe-xh', directory: 'dev51/fe-xh' }, 'my-app', defaults, '/tmp/custom'),
  path.resolve('dev51/fe-xh/my-app'),
  'sync -d 不影响已配置 group.directory'
);

const allDirs = getAllGroupDirectories(newConfig).sort();
assertEqual(
  JSON.stringify(allDirs),
  JSON.stringify([path.resolve('dev51/fe-xh'), path.resolve('dev51/xbb')].sort()),
  'getAllGroupDirectories 返回所有 group 目录'
);

assertEqual(
  getAllGroupDirectories(newConfig, { groupPath: 'dev51/xbb' }).length,
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
  Boolean(findGroupByPath(newConfig, 'dev51/fe-xh')),
  'findGroupByPath 可找到 group 配置'
);

assertEqual(
  resolveGroupDirectory(legacyConfig.gitlab.groups[0], legacyConfig.defaults),
  path.resolve('../fe-xh'),
  '旧 config 兼容: 无 directory 字段时使用 defaults.directory'
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

createFakeRepo('dev51/fe-xh', 'repo-a');
createFakeRepo('dev51/xbb', 'repo-b');

const integrationConfig = JSON.parse(JSON.stringify(newConfig));
fs.writeFileSync(
  path.join(fakeHome, '.feops/config.json'),
  JSON.stringify(integrationConfig, null, 2)
);

process.chdir(workDir);

const scannedProjects = scanAllGitProjects(integrationConfig);
assertEqual(scannedProjects.length, 2, 'scanAllGitProjects 扫描两个 group 目录');
assert(
  scannedProjects.some(project => project.name === 'repo-a' && project.path.endsWith(`${path.sep}dev51${path.sep}fe-xh${path.sep}repo-a`)),
  'scanAllGitProjects 找到 dev51/fe-xh/repo-a'
);
assert(
  scannedProjects.some(project => project.name === 'repo-b' && project.path.endsWith(`${path.sep}dev51${path.sep}xbb${path.sep}repo-b`)),
  'scanAllGitProjects 找到 dev51/xbb/repo-b'
);

const filteredProjects = scanAllGitProjects(integrationConfig, { group: 'dev51/xbb' });
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

  assert(configListOutput.includes('dev51/fe-xh → dev51/fe-xh'), 'config list 显示 group 目录映射');
  assert(configListOutput.includes('dev51/xbb → dev51/xbb'), 'config list 显示第二个 group 映射');
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
