import { describe, expect, it } from "vitest";
import { buildWebdavConfigQrPayload, isWebdavConfigQrReady } from "./configQr";

describe("Settings configQr utility", () => {
  it("builds valid WebDAV QR payload", () => {
    const payload = buildWebdavConfigQrPayload({
      url: "https://dav.jianguoyun.com/dav/",
      username: "user@example.com",
      password: "app-password",
      basePath: "",
    });

    expect(payload.v).toBe(1);
    expect(payload.type).toBe("tiez-webdav");
    expect(payload.webdav.url).toBe("https://dav.jianguoyun.com/dav/");
    expect(payload.webdav.basePath).toBe("tiez-sync");
    expect(isWebdavConfigQrReady(payload)).toBe(true);
  });

  it("rejects incomplete WebDAV QR payloads", () => {
    const emptyPayload = buildWebdavConfigQrPayload({
      url: "  ",
      username: "",
      password: "",
      basePath: "",
    });
    expect(isWebdavConfigQrReady(emptyPayload)).toBe(false);
  });
});
