const { execFileSync } = require('node:child_process');
const { readFileSync, renameSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const appid = process.env.ROAM_APP_ID?.trim();
if (!/^wx[0-9a-f]{16}$/.test(appid || '')) {
  console.error('请设置 ROAM_APP_ID，格式为 wx 后接 16 位小写十六进制字符。');
  process.exit(1);
}

try {
  execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build:weapp:device'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, ROAM_PREVIEW_BUILD: '1' },
  });
  const filename = resolve(root, 'build/weapp-preview/project.config.json');
  const project = JSON.parse(readFileSync(filename, 'utf8'));
  if (project.miniprogramRoot !== './' || project.compileType !== 'miniprogram') {
    throw new Error('预览工程入口无效');
  }
  project.appid = appid;
  project.setting.urlCheck = true;
  writeFileSync(filename + '.tmp', JSON.stringify(project, null, 2) + '\n', { mode: 0o600 });
  renameSync(filename + '.tmp', filename);
  console.log('预览工程已生成。请在微信开发者工具中导入 miniapp/build/weapp-preview。');
} catch (error) {
  console.error('预览工程构建未完成，请检查构建输出。');
  process.exitCode = error.status || 1;
}
