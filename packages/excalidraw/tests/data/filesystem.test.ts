import { fileSave as nativeFileSave } from "browser-fs-access";

import { fileSave } from "../../data/filesystem";

vi.mock("browser-fs-access", () => ({
  fileOpen: vi.fn(),
  fileSave: vi.fn(),
  supported: true,
}));

const nativeFileSaveMock = vi.mocked(nativeFileSave);

describe("fileSave", () => {
  beforeEach(() => {
    nativeFileSaveMock.mockReset();
  });

  it("downloads the blob when the native save picker is blocked", async () => {
    nativeFileSaveMock.mockRejectedValue(
      new DOMException(
        "The request is not allowed by the user agent or the platform in the current context.",
        "NotAllowedError",
      ),
    );

    const clicks: { download: string; connected: boolean }[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(
      this: HTMLAnchorElement,
    ) {
      clicks.push({
        download: this.download,
        connected: this.isConnected,
      });
    };
    const view = document.defaultView!;
    const originalCreate = view.URL.createObjectURL;
    const originalRevoke = view.URL.revokeObjectURL;
    view.URL.createObjectURL = () => "blob:diagram";
    view.URL.revokeObjectURL = () => {};

    try {
      const handle = await fileSave(new Blob(["png"], { type: "image/png" }), {
        name: "Diagram",
        extension: "png",
        description: "Export to PNG",
        mimeTypes: ["image/png"],
      });

      expect(handle).toBeNull();
      expect(clicks).toEqual([{ download: "Diagram.png", connected: true }]);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      view.URL.createObjectURL = originalCreate;
      view.URL.revokeObjectURL = originalRevoke;
    }
  });

  it("does not download when the user dismisses the save picker", async () => {
    nativeFileSaveMock.mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    await expect(
      fileSave(new Blob(["png"], { type: "image/png" }), {
        name: "Diagram",
        extension: "png",
        description: "Export to PNG",
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
