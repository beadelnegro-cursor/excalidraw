import * as browserFsAccess from "browser-fs-access";
import { vi } from "vitest";

import { fileSave } from "../data/filesystem";

vi.mock("browser-fs-access", () => ({
  fileSave: vi.fn(),
  fileOpen: vi.fn(),
  supported: true,
}));

const downloads: { name: string; href: string }[] = [];

const saveOpts = {
  name: "drawing",
  extension: "png" as const,
  description: "Export to PNG",
};

describe("fileSave", () => {
  beforeEach(() => {
    downloads.length = 0;
    vi.mocked(browserFsAccess.fileSave).mockReset();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href });
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("returns the native file handle and does not start a second download", async () => {
    const handle = {
      kind: "file",
      name: "drawing.png",
    } as FileSystemFileHandle;
    vi.mocked(browserFsAccess.fileSave).mockResolvedValue(handle);

    const blob = new Blob(["png"], { type: "image/png" });
    await expect(fileSave(blob, saveOpts)).resolves.toBe(handle);
    expect(downloads).toEqual([]);
  });

  it("rejects when the user cancels the picker and does not download", async () => {
    const abortError = new DOMException(
      "The user aborted a request.",
      "AbortError",
    );
    vi.mocked(browserFsAccess.fileSave).mockRejectedValue(abortError);

    const blob = new Blob(["png"], { type: "image/png" });
    await expect(fileSave(blob, saveOpts)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(downloads).toEqual([]);
  });

  it("downloads the blob when the native picker is blocked", async () => {
    const blocked = new DOMException(
      "Failed to execute 'showSaveFilePicker' on 'Window': The request is not allowed by the user agent or the platform in the current context.",
      "NotAllowedError",
    );
    vi.mocked(browserFsAccess.fileSave).mockRejectedValue(blocked);

    const blob = new Blob(["png"], { type: "image/png" });
    await expect(fileSave(Promise.resolve(blob), saveOpts)).resolves.toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(downloads).toEqual([{ name: "drawing.png", href: "blob:export" }]);
  });
});
