import { describe, expect, it, vi } from 'vitest';
import { BrowserQaDirectory } from './obsidianQaBrowser';

describe('browser Q&A directory adapter', () => {
  it('refuses to open an existing Markdown file for writing', async () => {
    const getFileHandle = vi.fn();
    const handle = {
      name: '问答记录',
      entries: async function* () { yield ['2026-09-27-同名.md', { kind: 'file' }]; },
      getFileHandle,
    } as unknown as FileSystemDirectoryHandle;
    const directory = new BrowserQaDirectory(handle);
    await expect(directory.createNew('2026-09-27-同名.md', '新内容')).rejects.toThrow('同名文件已存在');
    expect(getFileHandle).not.toHaveBeenCalled();
  });

  it('only creates a new Markdown file and writes its content', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const getFileHandle = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    const handle = {
      name: '问答记录',
      entries: async function* () { /* Empty directory. */ },
      getFileHandle,
    } as unknown as FileSystemDirectoryHandle;
    const directory = new BrowserQaDirectory(handle);
    await directory.createNew('2026-09-27-问答.md', '# 问答');
    expect(getFileHandle).toHaveBeenCalledWith('2026-09-27-问答.md', { create: true });
    expect(write).toHaveBeenCalledWith('# 问答');
    expect(close).toHaveBeenCalledOnce();
  });
});
