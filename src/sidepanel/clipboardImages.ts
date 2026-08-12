interface ClipboardDataLike {
  files: ArrayLike<File>;
  items: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function imageExtension(file: File) {
  const filenameExtension = file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return MIME_EXTENSIONS[file.type.toLowerCase()] ?? filenameExtension ?? 'png';
}

function hasMeaningfulFilename(filename: string) {
  return Boolean(filename)
    && !/^(?:image|clipboard|blob)(?:[-_ ]?\d+)?(?:\.[a-z0-9]+)?$/i.test(filename.trim());
}

export function extractClipboardImages(clipboardData: ClipboardDataLike) {
  const directFiles = Array.from(clipboardData.files).filter((file) => file.type.startsWith('image/'));
  if (directFiles.length > 0) return directFiles;

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => {
      const file = item.getAsFile();
      if (!file || file.type) return file;
      return new File([file], file.name, {
        type: item.type,
        lastModified: file.lastModified,
      });
    })
    .filter((file): file is File => file !== null);
}

export function namePastedImages(files: File[], occupiedFilenames: string[]) {
  const occupied = new Set(occupiedFilenames.map((filename) => filename.toLocaleLowerCase()));
  let nextOrdinal = 1;

  return files.map((file) => {
    if (hasMeaningfulFilename(file.name)) {
      occupied.add(file.name.toLocaleLowerCase());
      return file;
    }

    const extension = imageExtension(file);
    let filename = `粘贴图片 ${nextOrdinal}.${extension}`;
    while (occupied.has(filename.toLocaleLowerCase())) {
      nextOrdinal += 1;
      filename = `粘贴图片 ${nextOrdinal}.${extension}`;
    }
    occupied.add(filename.toLocaleLowerCase());
    nextOrdinal += 1;

    return new File([file], filename, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}
