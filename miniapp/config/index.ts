import type { IProjectConfig } from '@tarojs/taro/types/compile';

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
  cache: { enable: false },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false }
    }
  }
};

export default config;
