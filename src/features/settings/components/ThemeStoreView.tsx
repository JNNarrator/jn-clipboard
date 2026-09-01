import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Download, RefreshCw, Search, Star } from "lucide-react";
import type { Locale } from "../../../shared/types";
import {
    ensureInstalledThemeStyle,
    listInstalledThemes,
    type InstalledThemeDefinition
} from "../../../shared/lib/themePackages";

type StoreTheme = {
    id: string;
    name: Partial<Record<Locale, string>>;
    description?: Partial<Record<Locale, string>>;
    author: string;
    category: string;
    version: string;
    minAppVersion?: string;
    downloadCount: number;
    avgRating: number;
    ratingCount: number;
    previewLightUrl: string;
    previewDarkUrl: string;
};

type ThemeListResponse = {
    themes: StoreTheme[];
    total: number;
};

interface ThemeStoreViewProps {
    t: (key: string) => string;
    language: Locale;
    theme: string;
    setTheme: (value: string) => void;
    saveAppSetting: (key: string, value: string) => void;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://tiez.name666.top").replace(/\/$/, "");
const CATEGORIES = ["", "nature", "minimal", "retro", "dark", "cute", "other"];

const absoluteAssetUrl = (url: string) => {
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
};

const localizedText = (
    value: Partial<Record<Locale, string>> | undefined,
    language: Locale,
    fallback: string
) => value?.[language] || value?.zh || value?.en || fallback;

const ThemeStoreView = ({
    t,
    language,
    theme,
    setTheme,
    saveAppSetting
}: ThemeStoreViewProps) => {
    const [themes, setThemes] = useState<StoreTheme[]>([]);
    const [installed, setInstalled] = useState<InstalledThemeDefinition[]>([]);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const darkMode = document.documentElement.classList.contains("dark-mode")
        || document.body.classList.contains("dark-mode");
    const installedIds = useMemo(() => new Set(installed.map(item => item.id)), [installed]);

    const loadThemes = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: "50", sort: "popular" });
            if (query.trim()) params.set("q", query.trim());
            if (category) params.set("category", category);
            const response = await fetch(`${API_BASE}/api/v1/themes?${params}`, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json() as ThemeListResponse;
            setThemes(result.themes || []);
            setInstalled(await listInstalledThemes());
        } catch (loadError) {
            if ((loadError as Error).name === "AbortError") return;
            console.error("Failed to load theme store:", loadError);
            setError(t("theme_store_load_failed"));
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [category, query, t]);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => void loadThemes(controller.signal), 250);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [loadThemes]);

    const applyInstalledTheme = async (themeId: string) => {
        const loaded = await ensureInstalledThemeStyle(themeId);
        if (!loaded) throw new Error(t("theme_package_load_failed"));
        setTheme(themeId);
        saveAppSetting("theme", themeId);
    };

    const installOrApply = async (storeTheme: StoreTheme) => {
        if (installingId) return;
        setInstallingId(storeTheme.id);
        setError(null);
        try {
            let installedTheme = installed.find(item => item.id === storeTheme.id);
            if (!installedTheme) {
                installedTheme = await invoke<InstalledThemeDefinition>("install_theme_from_store", {
                    themeId: storeTheme.id
                });
                await ensureInstalledThemeStyle(installedTheme.id, { force: true });
                setInstalled(current => [
                    ...current.filter(item => item.id !== installedTheme?.id),
                    installedTheme as InstalledThemeDefinition
                ]);
            }
            await applyInstalledTheme(storeTheme.id);
        } catch (installError) {
            console.error("Failed to install store theme:", installError);
            setError(`${t("theme_package_install_failed")}：${String(installError)}`);
        } finally {
            setInstallingId(null);
        }
    };

    return (
        <section className="theme-store-view" aria-busy={loading}>
            <div className="theme-store-controls">
                <label className="theme-store-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t("theme_store_search")}
                        aria-label={t("theme_store_search")}
                    />
                </label>
                <select
                    value={category}
                    onChange={event => setCategory(event.target.value)}
                    aria-label={t("theme_store_category")}
                >
                    {CATEGORIES.map(item => (
                        <option key={item || "all"} value={item}>
                            {item ? t(`theme_category_${item}`) : t("theme_category_all")}
                        </option>
                    ))}
                </select>
            </div>

            {error && (
                <div className="theme-store-status error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="btn-icon" onClick={() => void loadThemes()}>
                        <RefreshCw size={14} />
                        {t("retry")}
                    </button>
                </div>
            )}

            {loading ? (
                <div className="theme-store-status" role="status">{t("theme_store_loading")}</div>
            ) : themes.length === 0 ? (
                <div className="theme-store-status">{t("theme_store_empty")}</div>
            ) : (
                <div className="theme-store-list">
                    {themes.map(storeTheme => {
                        const name = localizedText(storeTheme.name, language, storeTheme.id);
                        const description = localizedText(storeTheme.description, language, "");
                        const isInstalled = installedIds.has(storeTheme.id);
                        const isActive = theme === storeTheme.id;
                        const isInstalling = installingId === storeTheme.id;
                        return (
                            <article className="theme-store-card" key={storeTheme.id}>
                                <img
                                    src={absoluteAssetUrl(darkMode ? storeTheme.previewDarkUrl : storeTheme.previewLightUrl)}
                                    alt=""
                                    className="theme-store-preview"
                                    loading="lazy"
                                />
                                <div className="theme-store-card-body">
                                    <div className="theme-store-card-title-row">
                                        <div>
                                            <h3>{name}</h3>
                                            <p>{t("theme_store_by")} {storeTheme.author}</p>
                                        </div>
                                        <span className="theme-store-category">
                                            {t(`theme_category_${storeTheme.category}`)}
                                        </span>
                                    </div>
                                    {description && <p className="theme-store-description">{description}</p>}
                                    <div className="theme-store-card-footer">
                                        <div className="theme-store-metrics">
                                            <span><Download size={12} />{storeTheme.downloadCount}</span>
                                            <span><Star size={12} />{storeTheme.avgRating.toFixed(1)}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={`btn-icon theme-store-install${isActive ? " active" : ""}`}
                                            disabled={isActive || isInstalling}
                                            onClick={() => void installOrApply(storeTheme)}
                                        >
                                            {isActive ? <Check size={14} /> : isInstalling ? <RefreshCw className="animate-spin" size={14} /> : <Download size={14} />}
                                            {isActive
                                                ? t("theme_store_current")
                                                : isInstalling
                                                    ? t("theme_store_installing")
                                                    : isInstalled
                                                        ? t("theme_store_apply")
                                                        : t("theme_store_install")}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default ThemeStoreView;
