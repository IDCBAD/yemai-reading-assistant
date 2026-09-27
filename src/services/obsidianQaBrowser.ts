import { yemaiDatabase } from '../data/database';
import type { QaDirectory, QaFile } from './obsidianQa';

const HANDLE_KEY = 'obsidian-qa-directory-handle-v1';

interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

export type QaDirectoryState =
  | { kind: 'unconfigured' | 'unsupported' }
  | { kind: 'ready' | 'needs-permission'; name: string }
  | { kind: 'error'; message: string; name?: string };

export class BrowserQaDirectory implements QaDirectory {
  constructor(readonly handle: FileSystemDirectoryHandle) {}

  get name() { return this.handle.name; }

  async listMarkdown(): Promise<QaFile[]> {
    const files: QaFile[] = [];
    for await (const [name, handle] of this.handle.entries()) {
      if (handle.kind !== 'file' || !name.toLocaleLowerCase().endsWith('.md')) continue;
      files.push({ name, content: await (await handle.getFile()).text() });
    }
    return files;
  }

  async createNew(name: string, content: string) {
    if (name.includes('/') || name.includes('\\') || !name.toLocaleLowerCase().endsWith('.md')) {
      throw new Error('无效的问答文件名。');
    }
    // Recheck immediately before creation. This adapter never opens an existing file for writing.
    for await (const [existingName] of this.handle.entries()) {
      if (existingName.toLocaleLowerCase() === name.toLocaleLowerCase()) throw new Error('同名文件已存在，请重新保存。');
    }
    const file = await this.handle.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return Boolean(value && typeof value === 'object'
    && (value as FileSystemDirectoryHandle).kind === 'directory'
    && typeof (value as FileSystemDirectoryHandle).getFileHandle === 'function');
}

export async function loadQaDirectory(): Promise<{ directory?: QaDirectory; state: QaDirectoryState }> {
  if (typeof (window as DirectoryPickerWindow).showDirectoryPicker !== 'function') {
    return { state: { kind: 'unsupported' } };
  }
  const saved = (await yemaiDatabase.meta.get(HANDLE_KEY))?.value;
  if (!isDirectoryHandle(saved)) return { state: { kind: 'unconfigured' } };
  const permission = await (saved as PermissionHandle).queryPermission({ mode: 'readwrite' });
  return {
    directory: new BrowserQaDirectory(saved),
    state: { kind: permission === 'granted' ? 'ready' : 'needs-permission', name: saved.name },
  };
}

export async function chooseQaDirectory(): Promise<{ directory: QaDirectory; state: QaDirectoryState }> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持持续访问本地目录。');
  const handle = await picker.call(window, { id: 'yemai-qa-directory', mode: 'readwrite' });
  await yemaiDatabase.meta.put({ key: HANDLE_KEY, value: handle });
  return { directory: new BrowserQaDirectory(handle), state: { kind: 'ready', name: handle.name } };
}

export async function authorizeQaDirectory(directory: QaDirectory): Promise<QaDirectoryState> {
  if (!(directory instanceof BrowserQaDirectory)) throw new Error('目录连接无效，请重新选择。');
  const permission = await (directory.handle as PermissionHandle).requestPermission({ mode: 'readwrite' });
  return { kind: permission === 'granted' ? 'ready' : 'needs-permission', name: directory.name };
}

export async function disconnectQaDirectory() {
  await yemaiDatabase.meta.delete(HANDLE_KEY);
}
