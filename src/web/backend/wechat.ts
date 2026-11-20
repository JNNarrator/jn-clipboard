/**
 * WeChat channel commands for the web build.
 *
 * The desktop build reaches these through Rust (`app/commands/wechat_cmd.rs`),
 * which proxies to JNClub so the webview never holds the token and never hits
 * CORS. A browser tab has neither problem: `jn-token` is already in
 * localStorage for sync, and the request is same-origin once the page is
 * served from the JNClub host. So here the calls go straight out with fetch.
 *
 * Kept deliberately thin — every rule about scanning, sessions and message
 * routing lives on the server. This file only moves bytes.
 */
import { readToken } from "../sync/token";
import { invoke } from "@tauri-apps/api/core";

const SERVER_KEY = "web.sync_base_url";

export interface WechatStatus {
    state: string;
    connected: boolean;
    userId?: string | null;
    error?: string | null;
    waitingScan: boolean;
    notifyOnCopy: boolean;
    whitelist?: string | null;
    enabled?: boolean;
}

export interface QrcodeResult {
    connected: boolean;
    qrcodeContent?: string | null;
    qrcodeImage?: string | null;
    message?: string | null;
}

function defaultBaseUrl(): string {
    return import.meta.env.VITE_JNCLUB_BASE_URL ?? `${window.location.origin}/jnclub`;
}

async function baseUrl(): Promise<string> {
    const settings = (await invoke("get_settings")) as Record<string, string>;
    return (settings[SERVER_KEY] || defaultBaseUrl()).replace(/\/+$/u, "");
}

async function call<T>(method: "GET" | "POST", path: string): Promise<T> {
    const token = readToken();
    if (!token) {
        throw new Error("尚未登录 JNClub");
    }
    const response = await fetch(`${await baseUrl()}${path}`, {
        method,
        headers: { "jn-token": token },
    });
    if (response.status === 401) {
        throw new Error("登录已过期，请重新登录");
    }
    if (!response.ok) {
        throw new Error(`同步服务返回 ${response.status}`);
    }
    const envelope = (await response.json()) as { code: number; message?: string; data?: T };
    if (envelope.code !== 200) {
        throw new Error(envelope.message || `请求失败（${envelope.code}）`);
    }
    return envelope.data as T;
}

export const getWechatStatus = (): Promise<WechatStatus> => call("GET", "/api/wechat/status");

export const requestWechatQrcode = (): Promise<QrcodeResult> => call("POST", "/api/wechat/qrcode");

export const stopWechatChannel = async (): Promise<null> => {
    await call("POST", "/api/wechat/stop");
    return null;
};

export const resumeWechatChannel = (): Promise<{ resumed: boolean; state: string }> =>
    call("POST", "/api/wechat/resume");

/**
 * 更新当前用户的通道设置。
 *
 * 参数走 query string，与后端 @RequestParam 对应；白名单里的 @ 与空格
 * 必须编码，否则会被当成 query 分隔符。
 */
export const updateWechatSettings = async (
    whitelist?: string,
    notifyOnCopy?: boolean,
): Promise<WechatStatus> => {
    const params = new URLSearchParams();
    if (whitelist !== undefined) params.set("whitelist", whitelist);
    if (notifyOnCopy !== undefined) params.set("notifyOnCopy", String(notifyOnCopy));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return call("POST", `/api/wechat/settings${suffix}`);
};
