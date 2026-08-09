import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '页边 · AI 阅读助手',
    short_name: '页边',
    description: '在浏览器侧边栏中引用网页、连续提问和整理阅读上下文。',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage'],
    host_permissions: ['https://power-api.yingdao.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' https://power-api.yingdao.com",
    },
    action: {
      default_title: '打开页边',
    },
  },
});
