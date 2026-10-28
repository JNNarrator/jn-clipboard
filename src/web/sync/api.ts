/**
 * HTTP client for `jnclub-module-clipboard`.
 *
 * Every call goes through the `R<T>` envelope the JNClub backend uses
 * (`{ code, message, data }`), so a business-level failure arrives as HTTP 200
 * and still has to be turned into an exception here — otherwise a rejected push
 * looks like an empty one.
 */
import type { PullResponse, PushResponse, RecordDto, SettingDto } from "./types";

const DEFAULT_LIMIT = 200;

export interface SyncConfig {
  /** Origin of the JNClub backend, e.g. `https://jiangnan.88933.vip`. */
  baseUrl: string;
  /** Sa-Token value sent as `jn-token`. */
  token: string;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface SyncApiOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class SyncApi {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: SyncConfig,
    options: SyncApiOptions = {},
  ) {
    // Bound to globalThis so a bare `fetch` reference keeps working in browsers
    // that brand-check the receiver.
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** One page of changes after `since`. */
  async pull(since: number, limit = DEFAULT_LIMIT): Promise<PullResponse> {
    const query = new URLSearchParams({ since: String(since), limit: String(limit) });
    const data = await this.request<PullResponse>("GET", `/api/clipboard/sync/pull?${query}`);
    return {
      records: data?.records ?? [],
      settings: data?.settings ?? [],
      nextSeq: data?.nextSeq ?? since,
      hasMore: data?.hasMore ?? false,
    };
  }

  async push(
    records: RecordDto[],
    settings: SettingDto[],
  ): Promise<PushResponse> {
    const data = await this.request<PushResponse>("POST", "/api/clipboard/sync/push", {
      records,
      settings,
      // Attachments are not modelled in the browser build yet; an empty list
      // keeps the server's blob reference counting honest.
      blobs: [],
    });
    return {
      accepted: data?.accepted ?? [],
      conflicts: data?.conflicts ?? [],
      rejectedSettings: data?.rejectedSettings ?? [],
      nextSeq: data?.nextSeq ?? 0,
    };
  }

  /** The user's current server cursor, useful before deciding to pull. */
  async state(): Promise<number> {
    return (await this.request<number>("GET", "/api/clipboard/sync/state")) ?? 0;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/+$/u, "")}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "jn-token": this.config.token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new SyncError(`无法连接同步服务：${(error as Error).message}`);
    }

    if (response.status === 401) throw new SyncError("登录已过期，请重新登录", 401);
    if (!response.ok) throw new SyncError(`同步服务返回 ${response.status}`, response.status);

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new SyncError("同步服务返回了无法解析的内容", response.status);
    }
    if (envelope?.code !== 200) {
      throw new SyncError(envelope?.message || `同步失败（${envelope?.code}）`, response.status, envelope?.code);
    }
    return envelope.data;
  }
}
