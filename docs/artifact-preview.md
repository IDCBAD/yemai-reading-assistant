# 产物在线预览

2026-10-02：产物预览与原生工具栏已实现，用户已确认功能与视觉并授权合入 `main`；尚未正式发布。使用合成文件完成浏览器和构建扩展验证，自动化未覆盖真实 WorkOS 文件链接。

## 使用方式

- 点击图片进入预览；支持缩放按钮、滚轮缩放、拖动、原始尺寸和适应窗口。双击切换原始尺寸与适应窗口，画布支持加减键缩放、方向键移动、`0` 恢复适应窗口。
- 文件卡片提供“预览”和“下载”，文件名也是预览入口。
- 预览窗口支持“新标签页查看”，适合宽表格和报告。关闭后恢复到原来的卡片焦点。
- 输入图片复用同一个图片查看器；收藏卡片的产物链接本轮保留原有打开方式。
- 工具栏采用浅灰底与无边框图标操作；文档查看方式使用下划线文字页签。图片底部将缩放比例与尺寸切换分组。文件卡片保留文字“预览”入口，下载使用图标；各图标有操作名称，键盘焦点可见，触屏扩大点击区域。只有悬停和按下反馈，视图切换与缩放立即响应。

## 格式和限制

| 格式 | 展示 | 限制 |
| --- | --- | --- |
| 图片 | 默认适应窗口，显示实际缩放比例 | 100% 以读取到的图片像素尺寸为准；缩放最大 800% |
| Markdown | 正文、原文、表格、代码和 Mermaid | 超过 200,000 字符时分段显示原文；相对链接和图片按文件地址解析 |
| HTML | 静态报告、源码 | 禁止脚本、表单提交、嵌入页面、自动跳转和链接导航；保留内联 CSS，外部样式表不加载；交互页面需下载使用 |
| Excel | XLS / XLSX / XLSM 的可见工作表、基本数字格式 | 不运行宏或重新计算公式；优先显示已有计算结果；不还原图表和复杂排版 |
| CSV | 表格、原文 | 保留前导零、引用逗号、多行文本和看起来像公式的字符串 |
| JSON | 格式化、原文、语法高亮 | 格式有误时保留原文；格式化仅影响展示，复制仍保留原始内容 |
| TXT | 文本、复制 | 不编辑原文件 |

- 文本文件最多读取 2 MiB，Excel / CSV 最多读取 10 MiB；同时检查声明大小和实际流式读取大小。
- 读取和解析总时间最多 20 秒。关闭预览取消请求并停止表格后台线程。
- 表格每个工作表预览前 2,000 行、100 列以内的数据，每次展示 100 行，通过上一批 / 下一批切换。截断时明确提示下载完整文件。
- 文本原文每次追加 20,000 字符，长文本不做语法高亮。
- 文件必须是无内嵌用户名或密码的 HTTPS 地址；读取受现有扩展 `host_permissions` 和 `connect-src` 限制。不会向文件地址附带 WorkOS 连接凭据。
- 本轮没有扩大扩展域名权限。其他文件域名、失效链接、密码文件和不支持的编码应回退到下载。

## 临时预览记录

独立标签页地址只包含随机编号。扩展用 `chrome.storage.session` 传递产物元数据，读取后移除传递记录；标签页自己的 `sessionStorage` 支持刷新，记录有效期一小时，不保存文件二进制。修改预览编号会重新加载对应文件。开发原型用本地模拟数据，不访问真实 WorkOS 文件。

## 验证

- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/vitest/vitest.mjs run src/sidepanel/artifactPreview.test.ts src/sidepanel/spreadsheetPreview.test.ts src/sidepanel/components/MessageList.collection.test.tsx src/sidepanel/codeBlockLanguage.test.ts src/sidepanel/codeHighlight.test.tsx`
- `node node_modules/wxt/bin/wxt.mjs build`
- 原型：`node scripts/serve-artifact-preview-prototype.mjs`，地址为 `http://127.0.0.1:5188/output/artifact-preview/prototype.html`。
- 浏览器：`node scripts/verify-artifact-preview.mjs <Playwright 模块目录>`，可使用 Codex 桌面提供的 Playwright；不需要添加生产依赖。使用独立测试配置，校验原型和构建后的扩展。
- 浏览器结果和截图在忽略的 `output/artifact-preview/` 下，包括 `verification.json`。结果只证明合成文件在测试浏览器中的行为，不证明真实 WorkOS 链接可读。
- 全量测试仍有两个既有失败文件：`workosInternalV2.test.ts` 和 `workosFileUpload.test.ts`，原因是 `jsencrypt` 在 Node 测试环境中读取不存在的 `window`；本轮未修改相关模块。

人工检查：重新加载 `.output/chrome-mv3` 扩展，用现有会话中的图片及各类产物验证链接有效期、读取权限、中文编码、报告资源和下载行为。
