import { describe, expect, test } from "vitest";
import { SyncError, isAuthExpired } from "./api";

/**
 * The settings panel decides whether to show the re-login button from these
 * strings: a false positive turns a working session into a scare, a false
 * negative leaves the user with a red line and no button (the very bug the
 * button exists for).
 */
describe("isAuthExpired", () => {
  test("recognises the 401 message shape", () => {
    expect(isAuthExpired(String(new SyncError("登录已过期，请重新登录", 401)))).toBe(true);
    expect(isAuthExpired("登录已过期，请重新登录")).toBe(true);
  });

  test("recognises the recorded last_error strings", () => {
    // The background runner records whatever the engine threw; both the
    // message text and an envelope-code style string must count.
    expect(isAuthExpired("登录已过期，请重新登录 (401)")).toBe(true);
    expect(isAuthExpired("Session expired")).toBe(true);
  });

  test("leaves network and server failures alone", () => {
    expect(isAuthExpired("无法连接同步服务：fetch failed")).toBe(false);
    expect(isAuthExpired("同步服务返回 502")).toBe(false);
    expect(isAuthExpired("附件下载失败（404）")).toBe(false);
    expect(isAuthExpired("")).toBe(false);
  });
});
