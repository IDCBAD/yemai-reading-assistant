import { parseSpreadsheet } from './spreadsheetPreview';

self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; csv: boolean }>) => {
  try { self.postMessage({ sheets: parseSpreadsheet(event.data.bytes, event.data.csv) }); }
  catch { self.postMessage({ error: '表格解析失败，文件可能受密码保护、编码不支持或格式有误，请下载后查看。' }); }
};
