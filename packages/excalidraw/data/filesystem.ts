import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from "browser-fs-access";

import { MIME_TYPES } from "@excalidraw/common";

import { normalizeFile } from "./blob";

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, "binary">;

export const fileOpen = async <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const mimeTypes = opts.extensions?.reduce((mimeTypes, type) => {
    mimeTypes.push(MIME_TYPES[type]);

    return mimeTypes;
  }, [] as string[]);

  const extensions = opts.extensions?.reduce((acc, ext) => {
    if (ext === "jpg") {
      return acc.concat(".jpg", ".jpeg");
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

  const files = await _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  });

  if (Array.isArray(files)) {
    return (await Promise.all(
      files.map((file) => normalizeFile(file)),
    )) as RetType;
  }
  return (await normalizeFile(files)) as RetType;
};

/**
 * Anchor download used when the native save picker exists but the platform
 * refuses it (cross-origin iframe, lost user activation, enterprise policy).
 * `browser-fs-access` does not fall back on its own in that case, so the
 * export would otherwise finish with no file.
 */
const downloadBlob = async (
  blob: Blob | Promise<Blob>,
  fileName: string,
): Promise<null> => {
  const data = await blob;
  const ownerDocument = globalThis.document;
  if (!ownerDocument?.body) {
    throw new Error("Cannot download file");
  }
  const view = ownerDocument.defaultView ?? globalThis;
  const url = view.URL.createObjectURL(data);
  const anchor = ownerDocument.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  // A detached anchor's click is dropped in some browsers, so the download
  // never starts. Keep it in the document for the click.
  ownerDocument.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 30_000);
  return null;
};

export const fileSave = async (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    mimeTypes?: string[];
    description: string;
    /** existing FileSystemFileHandle */
    fileHandle?: FileSystemFileHandle | null;
  },
) => {
  const fileName = `${opts.name}.${opts.extension}`;
  try {
    return await _fileSave(
      blob,
      {
        fileName,
        description: opts.description,
        extensions: [`.${opts.extension}`],
        mimeTypes: opts.mimeTypes,
      },
      opts.fileHandle,
      false,
    );
  } catch (error: any) {
    // The user dismissed the picker. Callers mute this and must not save.
    if (error?.name === "AbortError") {
      throw error;
    }
    // The File System Access API can be present and still be blocked. The
    // library then throws instead of using its legacy download, and the
    // PNG/SVG export produces nothing.
    if (nativeFileSystemSupported) {
      return downloadBlob(blob, fileName);
    }
    throw error;
  }
};

export { nativeFileSystemSupported };
