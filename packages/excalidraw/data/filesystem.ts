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

const saveWithAnchor = async (blob: Blob | Promise<Blob>, fileName: string) => {
  const url = URL.createObjectURL(await blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // An immediate revoke cancels the download in Chrome.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return null;
};

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: unknown }).name === "AbortError";

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
  } catch (error) {
    // The user dismissed the picker. A download here would ignore that.
    if (isAbortError(error) || !nativeFileSystemSupported) {
      throw error;
    }
    // The native saver is chosen once, at import. It does not fall back when
    // showSaveFilePicker rejects. That is site policy or a lost user
    // activation. A cross-origin iframe never gets here.
    return saveWithAnchor(blob, fileName);
  }
};

export { nativeFileSystemSupported };
