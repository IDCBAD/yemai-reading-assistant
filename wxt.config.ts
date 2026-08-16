import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '页脉 · AI 阅读助手',
    short_name: '页脉',
    description: '读过的，终会连起来。时间让零散的阅读，慢慢显出形状。',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'favicon'],
    host_permissions: [
      'https://power-api.yingdao.com/*',
      'https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com/*',
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https://power-api.yingdao.com https://winrobot-ai-power.oss-cn-hangzhou.aliyuncs.com; img-src 'self' data: blob: https:",
    },
    action: {
      default_title: '打开页脉',
      default_icon: {
        16: 'icons/extension/icon-16.png',
        32: 'icons/extension/icon-32.png',
        48: 'icons/extension/icon-48.png',
        128: 'icons/extension/icon-128.png',
      },
    },
    icons: {
      16: 'icons/extension/icon-16.png',
      32: 'icons/extension/icon-32.png',
      48: 'icons/extension/icon-48.png',
      128: 'icons/extension/icon-128.png',
    },
  },
});
