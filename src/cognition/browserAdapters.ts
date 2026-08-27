import type { YemaiDatabase } from '../data/database';
import { yemaiDatabase } from '../data/database';
import type {
  CognitionDirectory,
  CognitionDirectoryEntry,
  CognitionDirectoryRegistry,
  CognitionProjection,
  CognitionProjectionRow,
} from './cognitionLoop';

interface PermissionCapableHandle {
  queryPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const DIRECTORY_HANDLE_KEY = 'cognition-directory-handle-v1';

function permissions(handle: FileSystemDirectoryHandle) {
  return handle as FileSystemDirectoryHandle & PermissionCapableHandle;
}

async function readFile(handle: FileSystemFileHandle) {
  return (await handle.getFile()).text();
}

async function collectMarkdown(
  directory: FileSystemDirectoryHandle,
  prefix = '',
): Promise<CognitionDirectoryEntry[]> {
  const entries: CognitionDirectoryEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    const relativeName = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      entries.push({ name: `${relativeName}/`, text: '' });
      entries.push(...await collectMarkdown(handle, relativeName));
    } else {
      const file = await handle.getFile();
      entries.push({
        name: relativeName,
        fingerprint: `${file.lastModified}:${file.size}`,
        ...(name.toLocaleLowerCase().endsWith('.md') ? {} : { text: '' }),
      });
    }
  }
  return entries;
}

async function resolveDirectoryAndName(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const segments = path.split('/').filter(Boolean);
  const filename = segments.pop();
  if (!filename) throw new Error('认知文件名无效。');
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, filename };
}

export class BrowserCognitionDirectory implements CognitionDirectory {
  constructor(readonly rawHandle: FileSystemDirectoryHandle) {}

  get name() {
    return this.rawHandle.name;
  }

  queryPermission() {
    return permissions(this.rawHandle).queryPermission({ mode: 'readwrite' });
  }

  requestPermission() {
    return permissions(this.rawHandle).requestPermission({ mode: 'readwrite' });
  }

  async read(name: string) {
    const target = await resolveDirectoryAndName(this.rawHandle, name, false);
    return readFile(await target.directory.getFileHandle(target.filename));
  }

  async write(name: string, value: string) {
    const target = await resolveDirectoryAndName(this.rawHandle, name, true);
    const file = await target.directory.getFileHandle(target.filename, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(value);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async remove(name: string) {
    const target = await resolveDirectoryAndName(this.rawHandle, name, false);
    await target.directory.removeEntry(target.filename);
  }

  entries() {
    return collectMarkdown(this.rawHandle);
  }
}

export class DexieCognitionDirectoryRegistry implements CognitionDirectoryRegistry {
  constructor(private readonly database: YemaiDatabase = yemaiDatabase) {}

  async load() {
    const row = await this.database.meta.get(DIRECTORY_HANDLE_KEY);
    const value = row?.value;
    return value && typeof value === 'object'
      && (value as Partial<FileSystemDirectoryHandle>).kind === 'directory'
      && typeof (value as Partial<FileSystemDirectoryHandle>).getFileHandle === 'function'
      ? new BrowserCognitionDirectory(value as FileSystemDirectoryHandle)
      : undefined;
  }

  async save(directory: CognitionDirectory) {
    if (!(directory instanceof BrowserCognitionDirectory)) throw new Error('只能保存浏览器目录连接。');
    await this.database.meta.put({ key: DIRECTORY_HANDLE_KEY, value: directory.rawHandle });
  }

  async clear() {
    await this.database.meta.delete(DIRECTORY_HANDLE_KEY);
  }
}

export class DexieCognitionProjection implements CognitionProjection {
  constructor(private readonly database: YemaiDatabase = yemaiDatabase) {}

  async replace(rows: CognitionProjectionRow[]) {
    await this.database.transaction('rw', this.database.cognitionProjection, async () => {
      await this.database.cognitionProjection.clear();
      await this.database.cognitionProjection.bulkPut(rows);
    });
  }

  async put(row: CognitionProjectionRow) {
    await this.database.cognitionProjection.put(row);
  }

  all() {
    return this.database.cognitionProjection.toArray();
  }
}

export function supportsCognitionDirectory(windowObject: Window = window) {
  return typeof (windowObject as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickCognitionDirectory(windowObject: Window = window) {
  const picker = (windowObject as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持持续访问本地认知目录，请使用最新版 Chrome。');
  const handle = await picker.call(windowObject, { id: 'yemai-cognition-directory', mode: 'readwrite' });
  return new BrowserCognitionDirectory(handle);
}
