import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../backend/db";
import { captureEntry, deleteEntry, listHistory, markUsed, setNote } from "../backend/history";
import { syncNow, lastSeq } from "./engine";
import type { PullResponse, PushResponse, RecordDto, SettingDto } from "./types";

const BASE = "https://example.test";
const CONFIG = { baseUrl: BASE, token: "test-token" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stand-in for `ClipboardSyncService`, following the same rules: server-assigned
 * `seq`, rev-based optimistic locking, and a settings whitelist. Keeping the
 * imitation honest is the point of the test — the engine is only correct if it
 * matches the real contract.
 */
class FakeServer {
  records = new Map<string, RecordDto & { seq: number }>();
  settings = new Map<string, SettingDto & { seq: number }>();
  seq = 0;
  pushCalls = 0;

  private acceptsSetting(key: string): boolean {
    return key.startsWith("app.");
  }

  private samePayload(existing: RecordDto, incoming: RecordDto): boolean {
    return (
      existing.content === incoming.content &&
      (existing.deletedAt ?? null) === (incoming.deletedAt ?? null) &&
      (existing.isPinned ?? false) === (incoming.isPinned ?? false)
    );
  }

  handlePull(params: URLSearchParams): PullResponse {
    const since = Number(params.get("since") ?? 0);
    const limit = Number(params.get("limit") ?? 200);

    const merged = [
      ...[...this.records.values()].map((row) => ({ kind: "record" as const, row })),
      ...[...this.settings.values()].map((row) => ({ kind: "setting" as const, row })),
    ]
      .filter((item) => item.row.seq > since)
      .sort((a, b) => a.row.seq - b.row.seq);

    const page = merged.slice(0, limit);
    const records = page.filter((i) => i.kind === "record").map((i) => i.row as RecordDto);
    const settings = page.filter((i) => i.kind === "setting").map((i) => i.row as SettingDto);
    const nextSeq = page.length ? page[page.length - 1].row.seq : since;
    return { records, settings, nextSeq, hasMore: merged.length > page.length };
  }

  handlePush(body: { records?: RecordDto[]; settings?: SettingDto[] }): PushResponse {
    this.pushCalls += 1;
    const accepted: string[] = [];
    const conflicts: PushResponse["conflicts"] = [];
    const rejectedSettings: string[] = [];

    for (const incoming of body.records ?? []) {
      const existing = this.records.get(incoming.syncId);
      const incomingRev = incoming.rev ?? 1;
      if (!existing) {
        this.seq += 1;
        this.records.set(incoming.syncId, { ...incoming, seq: this.seq });
        accepted.push(incoming.syncId);
        continue;
      }
      if (incomingRev > existing.rev!) {
        this.seq += 1;
        this.records.set(incoming.syncId, { ...incoming, seq: this.seq });
        accepted.push(incoming.syncId);
        continue;
      }
      if (incomingRev === existing.rev && this.samePayload(existing, incoming)) {
        accepted.push(incoming.syncId);
        continue;
      }
      conflicts.push({ syncId: incoming.syncId, serverRev: existing.rev!, serverRecord: existing });
    }

    for (const incoming of body.settings ?? []) {
      if (!this.acceptsSetting(incoming.key)) {
        rejectedSettings.push(incoming.key);
        continue;
      }
      const existing = this.settings.get(incoming.key);
      if (!existing || (incoming.rev ?? 1) >= existing.rev!) {
        this.seq += 1;
        this.settings.set(incoming.key, { ...incoming, seq: this.seq });
      }
      accepted.push(incoming.key);
    }

    return { accepted, conflicts, rejectedSettings, nextSeq: this.seq };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    if (headers.get("jn-token") !== CONFIG.token) {
      return json({ code: 401, message: "未登录", data: null }, 401);
    }
    if (url.pathname === "/api/clipboard/sync/pull") {
      return json({ code: 200, message: "success", data: this.handlePull(url.searchParams) });
    }
    if (url.pathname === "/api/clipboard/sync/push") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return json({ code: 200, message: "success", data: this.handlePush(body) });
    }
    return json({ code: 404, message: "no route", data: null }, 404);
  };
}

beforeEach(async () => {
  await db.entries.clear();
  await db.settings.clear();
  await db.meta.clear();
});

async function run(server: FakeServer) {
  return syncNow(CONFIG, { fetchImpl: server.fetch });
}

describe("push", () => {
  test("uploads dirty rows and settles them", async () => {
    const server = new FakeServer();
    await captureEntry({ content: "from this device" });

    const outcome = await run(server);
    expect(outcome.pushed).toBeGreaterThanOrEqual(1);

    const rows = await db.entries.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].dirty).toBe(0);
    expect(server.records.size).toBe(1);
  });

  test("a later edit bumps rev and uploads again", async () => {
    const server = new FakeServer();
    const id = await captureEntry({ content: "original" });
    await run(server);
    expect((await db.entries.get(id))?.rev).toBe(1);

    await setNote(id, "a note");
    const before = (await db.entries.get(id))!.rev;
    expect(before).toBe(2);

    await run(server);
    const stored = [...server.records.values()][0];
    expect(stored.rev).toBe(2);
    expect(stored.note).toBe("a note");
  });

  test("a device-private setting is settled once the server rejects it", async () => {
    const server = new FakeServer();
    await db.settings.put({
      key: "web.sync_base_url",
      value: BASE,
      sync_id: "s-1",
      rev: 1,
      dirty: 1,
    });

    await run(server);
    // Not stored server-side, but no longer dirty either: otherwise every sync
    // would re-upload it forever.
    expect(server.settings.has("web.sync_base_url")).toBe(false);
    expect((await db.settings.get("web.sync_base_url"))?.dirty).toBe(0);
  });

  test("an app setting round-trips", async () => {
    const server = new FakeServer();
    await db.settings.put({
      key: "app.theme",
      value: "mica",
      sync_id: "s-2",
      rev: 1,
      dirty: 1,
    });

    await run(server);
    expect(server.settings.get("app.theme")?.value).toBe("mica");
    expect((await db.settings.get("app.theme"))?.dirty).toBe(0);
  });

  test("marking a clip used stays device-local", async () => {
    // A paste bumps use_count / last_used_at / sort_at and nothing else. That
    // must not re-ship the record: the counters would fight the other
    // devices' counters and image rows would re-upload their bytes forever.
    const server = new FakeServer();
    const id = await captureEntry({ content: "pasted often" });
    await run(server);
    expect(server.pushCalls).toBe(1);

    await markUsed(id);

    const row = (await db.entries.get(id))!;
    expect(row.use_count).toBe(1); // the stats themselves still move
    expect(row.rev).toBe(1); // no version bump
    expect(row.dirty).toBe(0); // nothing queued

    await run(server);
    expect(server.pushCalls).toBe(1);
    expect([...server.records.values()][0].rev).toBe(1);
  });

  test("an image with a known digest is referenced, not re-uploaded", async () => {
    const server = new FakeServer();
    let uploads = 0;
    const countingFetch: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/api/clipboard/blob") {
        uploads += 1;
      }
      return server.fetch(input, init);
    };

    const digest = "a".repeat(64);
    // A row a previous round already uploaded (sync_blob names the digest) and
    // that is dirty again for a reason unrelated to its content: pinned.
    await db.entries.add({
      content_type: "image",
      content: "data:image/png;base64,AAAA",
      preview: "图片",
      source_app: "Web",
      created_at: 1,
      last_used_at: 1,
      sort_at: 2,
      is_pinned: true,
      tags: [],
      use_count: 0,
      sync_blob: digest,
    });

    const outcome = await syncNow(CONFIG, { fetchImpl: countingFetch });
    expect(uploads).toBe(0);
    expect(outcome.pushed).toBeGreaterThanOrEqual(1);
    const [stored] = [...server.records.values()];
    expect(stored.content).toBe(digest);
    expect((await db.entries.where("dirty").equals(1).count())).toBe(0);
  });

  test("a large backlog travels in batches", async () => {
    const server = new FakeServer();
    for (let i = 0; i < 150; i += 1) {
      await db.entries.add({
        content_type: "text",
        content: `clip ${i}`,
        preview: `clip ${i}`,
        source_app: "Web",
        created_at: i,
        last_used_at: i,
        sort_at: i,
        is_pinned: false,
        tags: [],
        use_count: 0,
      });
    }

    const outcome = await run(server);
    expect(outcome.pushed).toBe(150);
    // 150 rows at 100 per request: two bodies, not one the server might refuse.
    expect(server.pushCalls).toBe(2);
    expect(await db.entries.where("dirty").equals(1).count()).toBe(0);
  });
});

describe("pull", () => {
  test("remote rows land locally and the cursor advances", async () => {
    const server = new FakeServer();
    server.seq = 1;
    server.records.set("remote-1", {
      syncId: "remote-1",
      contentType: "text",
      content: "from the phone",
      preview: "from the phone",
      sourceApp: "Phone",
      isPinned: false,
      tags: [],
      useCount: 0,
      createdAt: 1,
      lastUsedAt: 1,
      sortAt: 1,
      rev: 1,
      seq: 1,
    });

    const outcome = await run(server);
    expect(outcome.pulled).toBe(1);

    const entries = await listHistory(10, 0);
    expect(entries.map((entry) => entry.content)).toEqual(["from the phone"]);
    expect(await lastSeq()).toBe(1);

    // A pulled row must not be queued straight back to the server.
    const [row] = await db.entries.toArray();
    expect(row.dirty).toBe(0);
  });

  test("a remote tombstone hides the entry", async () => {
    const server = new FakeServer();
    const id = await captureEntry({ content: "doomed" });
    await run(server);

    const syncId = (await db.entries.get(id))!.sync_id;
    const stored = server.records.get(syncId)!;
    server.seq += 1;
    server.records.set(syncId, { ...stored, deletedAt: 5, rev: 2, seq: server.seq });

    await run(server);
    expect(await listHistory(10, 0)).toEqual([]);
  });

  test("a local delete reaches the server as a tombstone", async () => {
    const server = new FakeServer();
    const id = await captureEntry({ content: "doomed" });
    await run(server);

    await deleteEntry(id);
    await run(server);

    const [stored] = [...server.records.values()];
    expect(stored.deletedAt).toBeGreaterThan(0);
    expect(stored.rev).toBe(2);
  });

  test("drains every page the server holds", async () => {
    const server = new FakeServer();
    for (let i = 0; i < 450; i += 1) {
      server.seq += 1;
      server.records.set(`bulk-${i}`, {
        syncId: `bulk-${i}`,
        contentType: "text",
        content: `clip ${i}`,
        preview: `clip ${i}`,
        sourceApp: "Phone",
        isPinned: false,
        tags: [],
        useCount: 0,
        createdAt: i,
        lastUsedAt: i,
        sortAt: i,
        rev: 1,
        seq: server.seq,
      });
    }

    const outcome = await run(server);
    // 450 rows at 200 per page: three requests, not one truncated response.
    expect(outcome.pulled).toBe(450);
    expect(await db.entries.count()).toBe(450);
    expect(await lastSeq()).toBe(450);
  });
});

describe("conflicts", () => {
  test("a stale local revision is replaced by the server's", async () => {
    const server = new FakeServer();
    const id = await captureEntry({ content: "local draft" });
    await run(server);

    const syncId = (await db.entries.get(id))!.sync_id;
    // The server moved on while this device was offline.
    const stored = server.records.get(syncId)!;
    server.seq += 1;
    server.records.set(syncId, { ...stored, content: "server truth", rev: 5, deletedAt: null, seq: server.seq });

    // A local edit that ends up at rev 2 -- older than the server's 5.
    await setNote(id, "mine");
    const outcome = await run(server);

    expect(outcome.conflicts).toBe(1);
    const row = await db.entries.get(id);
    expect(row?.content).toBe("server truth");
    expect(row?.rev).toBe(5);
    expect(row?.dirty).toBe(0);
  });
});

describe("duplicate merge", () => {
  test("a later remote copy of the same text merges, and its identity is tombstoned", async () => {
    // 本地 10:00 复制、已同步；另一台设备 10:05 复制了同一句话。
    // 本地行更早 → 保留身份，远端身份排墓碑。
    const server = new FakeServer();
    const id = await captureEntry({ content: "shared snippet" });
    await run(server);
    const localSyncId = (await db.entries.get(id))!.sync_id;

    server.seq += 1;
    server.records.set("remote-copy", {
      syncId: "remote-copy",
      contentType: "text",
      content: "shared snippet",
      preview: "shared snippet",
      sourceApp: "Phone",
      isPinned: false,
      tags: [],
      useCount: 0,
      createdAt: Date.now() + 1000,
      lastUsedAt: Date.now() + 1000,
      sortAt: Date.now() + 1000,
      rev: 1,
      seq: server.seq,
    });

    const outcome = await run(server);
    expect(outcome.pulled).toBeGreaterThanOrEqual(1);

    // 没有可见的重复行
    expect(await listHistory(10, 0)).toHaveLength(1);
    // 远端身份进墓碑，下一轮 push 把它带到服务器
    const tombstone = await db.entries.where("sync_id").equals("remote-copy").first();
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(tombstone?.dirty).toBe(1);

    await run(server);
    expect(server.records.get("remote-copy")?.deletedAt).toBeTruthy();
    // 本地行身份未变
    expect((await db.entries.get(id))!.sync_id).toBe(localSyncId);
  });

  test("an earlier remote copy adopts the local row's identity swap", async () => {
    // 手机更早复制：远端身份胜出 → 本地行改挂远端 syncId，旧身份排墓碑。
    const server = new FakeServer();
    const id = await captureEntry({ content: "same words" });
    await run(server);
    const oldSyncId = (await db.entries.get(id))!.sync_id;

    server.seq += 1;
    const remoteCreated = Date.now() - 60_000;
    server.records.set("remote-first", {
      syncId: "remote-first",
      contentType: "text",
      content: "same words",
      preview: "same words",
      sourceApp: "Phone",
      isPinned: false,
      tags: [],
      useCount: 0,
      createdAt: remoteCreated,
      lastUsedAt: remoteCreated,
      sortAt: remoteCreated,
      rev: 3,
      seq: server.seq,
    });

    const outcome = await run(server);
    expect(outcome.pulled).toBeGreaterThanOrEqual(1);

    const merged = await db.entries.get(id);
    expect(merged?.sync_id).toBe("remote-first");
    expect(merged?.rev).toBe(3);
    expect(merged?.dirty).toBe(0, "内容没变，不需要重推");
    // 收录时间取更早的（首次复制语义）
    expect(merged?.created_at).toBe(remoteCreated);

    // 旧身份的墓碑行已在库中等待下一轮
    const tombstone = await db.entries.where("sync_id").equals(oldSyncId).first();
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(await listHistory(10, 0)).toHaveLength(1);
  });

  test("a copy older than the merge window is kept as a second entry", async () => {
    // 超出窗口：两边都保留两条，至少两台设备不会做出相反决定。
    const server = new FakeServer();
    const id = await captureEntry({ content: "weekly report" });
    await run(server);

    server.seq += 1;
    server.records.set("remote-ancient", {
      syncId: "remote-ancient",
      contentType: "text",
      content: "weekly report",
      preview: "weekly report",
      sourceApp: "Phone",
      isPinned: false,
      tags: [],
      useCount: 0,
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      sortAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      rev: 1,
      seq: server.seq,
    });

    await run(server);
    expect(await listHistory(10, 0)).toHaveLength(2);
  });
});

describe("failures", () => {
  test("a rejected token surfaces and is remembered", async () => {
    const server = new FakeServer();
    await captureEntry({ content: "anything" });

    await expect(
      syncNow({ baseUrl: BASE, token: "wrong" }, { fetchImpl: server.fetch }),
    ).rejects.toThrow(/登录已过期/u);

    const meta = await db.meta.get("sync");
    expect(meta?.last_error).toMatch(/登录已过期/u);
    // The row stays dirty so the next attempt retries it.
    const [row] = await db.entries.toArray();
    expect(row.dirty).toBe(1);
  });
});
