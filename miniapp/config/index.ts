import type { IProjectConfig } from '@tarojs/taro/types/compile';
import { URL } from 'node:url';
import { isIP } from 'node:net';

function buildApiUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const invalid = 'ROAM_API_URL 须为 HTTPS 后端域名，可带路径前缀，不可含账号、密钥、查询参数或片段。';
  const address = value.trim();
  if (!/^https:\/\/[^/?#@]+(?:\/[^?#]*)?$/i.test(address) || /[\\\s]/.test(address)) throw new Error(invalid);
  let url: URL;
  try { url = new URL(address); } catch { throw new Error(invalid); }
  if (!url.hostname.includes('.') || isIP(url.hostname) || /\.(?:localhost|local)$/i.test(url.hostname)
      || !url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || url.port === '0') {
    throw new Error(invalid);
  }
  return url.href.replace(/\/+$/, '');
}

const config: IProjectConfig = {
  projectName: 'roam-wechat-miniapp',
  date: '2026-10-17',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: [],
  defineConstants: { __ROAM_DEFAULT_API_URL__: JSON.stringify(buildApiUrl(process.env.ROAM_API_URL)) },
  cache: { enable: false },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false }
    }
  }
};

export default config;
