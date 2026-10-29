import { afterEach, describe, expect, it, vi } from "vitest";
import { webCommands } from "./commands";

/**
 * The browser build asks GitHub itself, so the reply shape matters: the shared
 * settings footer reads `available`, `latestVersion` and `releaseUrl` off it.
 */

const checkUpdate = () => webCommands.check_update({}) as Promise<{
    currentVersion: string;
    latestVersion: string | null;
    available: boolean;
    releaseUrl: string | null;
    notes: string | null;
    publishedAt: string | null;
}>;

function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("check_update over the browser backend", () => {
    it("reports a newer release as available", async () => {
        stubFetch(200, {
            tag_name: "v99.0.0",
            html_url: "https://github.com/JNNarrator/jn-clipboard/releases/tag/v99.0.0",
            body: "  What changed  ",
            published_at: "2026-10-29T00:00:00Z"
        });

        const info = await checkUpdate();
        expect(info.available).toBe(true);
        expect(info.latestVersion).toBe("99.0.0");
        expect(info.releaseUrl).toContain("/releases/tag/v99.0.0");
        // The body is handed over as-is; only an empty one is dropped.
        expect(info.notes).toBe("  What changed  ");
        expect(info.publishedAt).toBe("2026-10-29T00:00:00Z");
    });

    it("treats the running version as up to date", async () => {
        stubFetch(200, {
            tag_name: `v${__APP_VERSION__}`,
            html_url: "https://example.test/release",
            body: "",
            published_at: null
        });

        const info = await checkUpdate();
        expect(info.available).toBe(false);
        expect(info.currentVersion).toBe(__APP_VERSION__);
        // An empty body is not worth a notes section.
        expect(info.notes).toBeNull();
    });

    it("treats an unpublished repository as having no release", async () => {
        stubFetch(404, { message: "Not Found" });

        const info = await checkUpdate();
        expect(info.available).toBe(false);
        expect(info.latestVersion).toBeNull();
        expect(info.releaseUrl).toBeNull();
    });

    it("surfaces a failed lookup as a network error", async () => {
        stubFetch(403, { message: "rate limited" });

        await expect(checkUpdate()).rejects.toThrow(/\[network\] GitHub answered 403/);
    });
});
