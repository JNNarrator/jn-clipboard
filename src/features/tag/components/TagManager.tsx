import { useState, useEffect, useRef, useMemo, useCallback, useId, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import {
    Edit2, Trash2, X, LayoutGrid, List,
    Clock, MousePointer2, Plus, ExternalLink, CheckSquare, Copy, StickyNote, Search, Ellipsis
} from 'lucide-react';
import AppModal from "../../../shared/components/AppModal";
import { getTagColor } from "../../../shared/lib/utils";
import { toTauriLocalImageSrc, withImageCacheBust } from "../../../shared/lib/localImageSrc";
import { activateForInput } from "../../../shared/lib/focus";
import { getNotePlaceholder } from "../../../shared/lib/platform";
import type { ClipboardEntry } from "../../../shared/types";

interface TagManagerProps {
    t: (key: string) => string;
    theme: string;
}

interface TagInfo {
    name: string;
    count: number;
}

export default function TagManager({ t, theme }: TagManagerProps) {
    const TAG_MANAGER_VIEW_MODE_KEY = "tiez_tag_manager_view_mode";
    const TAG_MANAGER_SPLIT_MIN_WIDTH = 320;
    const TAG_SIDEBAR_MIN = 96;
    const TAG_SIDEBAR_MAX = 260;
    const TAG_SIDEBAR_DEFAULT = 148;
    const [tags, setTags] = useState<TagInfo[]>([]);
    const [tagSearch, setTagSearch] = useState('');
    const [isTagSearchOpen, setIsTagSearchOpen] = useState(false);
    const tagSearchInputRef = useRef<HTMLInputElement | null>(null);
    const tagSearchButtonRef = useRef<HTMLButtonElement | null>(null);
    const tagSearchInputId = useId();
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [tagItems, setTagItems] = useState<ClipboardEntry[]>([]);
    const [tagColors, setTagColors] = useState<Record<string, string>>({});
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [tagMenu, setTagMenu] = useState<{ name: string; left: number; top: number } | null>(null);
    const tagMenuRef = useRef<HTMLDivElement | null>(null);
    const tagMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
    const tagMenuId = useId();
    const [newTagName, setNewTagName] = useState('');
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
        try {
            const saved = window.localStorage.getItem(TAG_MANAGER_VIEW_MODE_KEY);
            return saved === 'list' ? 'list' : 'grid';
        } catch {
            return 'grid';
        }
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ show: boolean, tagName: string | null }>({ show: false, tagName: null });
    const [itemDeleteConfirmation, setItemDeleteConfirmation] = useState<{ show: boolean, id: number | null }>({ show: false, id: null });
    const [sortBy, setSortBy] = useState<'time' | 'count'>('time');
    const [isCreatingItem, setIsCreatingItem] = useState(false);
    const [editingItem, setEditingItem] = useState<{ id: number, content: string } | null>(null);
    const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
    const ignoreNoteBlurRef = useRef(false);
    const [newItemContent, setNewItemContent] = useState('');
    const [isManageMode, setIsManageMode] = useState(false);
    const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
    const [sidebarWidth, setSidebarWidth] = useState(TAG_SIDEBAR_DEFAULT);
    const [isSplit, setIsSplit] = useState(false);
    const isTagSearchExpanded = isSplit || isTagSearchOpen || tagSearch.length > 0;
    const [isResizing, setIsResizing] = useState(false);
    const pageRef = useRef<HTMLDivElement | null>(null);
    const sidebarWidthRef = useRef(TAG_SIDEBAR_DEFAULT);

    const selectedTagRef = useRef<string | null>(null);
    useEffect(() => { selectedTagRef.current = selectedTag; }, [selectedTag]);
    useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);

    useEffect(() => {
        if (!isTagSearchOpen) return;
        let disposed = false;
        void activateForInput().catch(console.error).finally(() => {
            if (!disposed) tagSearchInputRef.current?.focus({ preventScroll: true });
        });
        return () => { disposed = true; };
    }, [isTagSearchOpen]);

    const closeTagSearch = () => {
        setTagSearch('');
        setIsTagSearchOpen(false);
        if (isSplit) tagSearchInputRef.current?.focus({ preventScroll: true });
        else tagSearchButtonRef.current?.focus({ preventScroll: true });
    };

    useEffect(() => {
        if (!tagMenu) return;
        const frame = requestAnimationFrame(() => {
            tagMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        });
        const handleOutsidePress = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!tagMenuRef.current?.contains(target) && !tagMenuTriggerRef.current?.contains(target)) {
                setTagMenu(null);
            }
        };
        const handleLayoutChange = (event: Event) => {
            if (!(event.target instanceof Node) || !tagMenuRef.current?.contains(event.target)) {
                setTagMenu(null);
            }
        };
        document.addEventListener('pointerdown', handleOutsidePress);
        window.addEventListener('scroll', handleLayoutChange, true);
        window.addEventListener('resize', handleLayoutChange);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('pointerdown', handleOutsidePress);
            window.removeEventListener('scroll', handleLayoutChange, true);
            window.removeEventListener('resize', handleLayoutChange);
        };
    }, [tagMenu]);

    useEffect(() => {
        try {
            window.localStorage.setItem(TAG_MANAGER_VIEW_MODE_KEY, viewMode);
        } catch {
            // Ignore storage write failures and keep UI functional.
        }
    }, [viewMode]);

    useEffect(() => {
        const el = pageRef.current;
        if (!el) return;

        const updateSplit = () => {
            setIsSplit(el.clientWidth >= TAG_MANAGER_SPLIT_MIN_WIDTH);
        };

        updateSplit();
        const observer = new ResizeObserver(updateSplit);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        invoke<Record<string, string>>("get_settings")
            .then((settings) => {
                const raw = settings["app.tag_manager_size"];
                if (!raw) return;
                const parsed = JSON.parse(raw) as { width?: number };
                if (typeof parsed.width === "number" && parsed.width >= TAG_SIDEBAR_MIN) {
                    setSidebarWidth(Math.min(parsed.width, TAG_SIDEBAR_MAX));
                }
            })
            .catch(console.error);
    }, []);

    const persistSidebarWidth = useCallback(() => {
        invoke("save_setting", {
            key: "app.tag_manager_size",
            value: JSON.stringify({ width: sidebarWidthRef.current, height: 0 }),
        }).catch(console.error);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (event: MouseEvent) => {
            const bounds = pageRef.current?.getBoundingClientRect();
            if (!bounds) return;
            const nextWidth = Math.min(
                Math.max(event.clientX - bounds.left, TAG_SIDEBAR_MIN),
                TAG_SIDEBAR_MAX
            );
            setSidebarWidth(nextWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            persistSidebarWidth();
        };

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [isResizing, persistSidebarWidth]);

    useEffect(() => {
        let unlisteners: (() => void)[] = [];
        const setupListeners = async () => {
            const handleUpdate = () => {
                // Don't refresh if we're in the middle of a delete operation
                if (isDeleting) return;
                fetchTags();
                if (selectedTagRef.current) loadTagItems(selectedTagRef.current);
            };
            unlisteners.push(await listen('clipboard-changed', handleUpdate));
            unlisteners.push(await listen('clipboard-updated', handleUpdate));
            unlisteners.push(await listen('clipboard-removed', handleUpdate));
        };
        setupListeners();
        return () => unlisteners.forEach(f => f());
    }, [isDeleting]);

    useEffect(() => { fetchTags(); }, []);

    const fetchTags = async () => {
        try {
            const [tagMap, colors] = await Promise.all([
                invoke<Record<string, number>>('get_all_tags_info'),
                invoke<Record<string, string>>('get_tag_colors')
            ]);

            const tagArray = Object.entries(tagMap).map(([name, count]) => ({ name, count }));
            tagArray.sort((a, b) => b.count - a.count);
            setTags(tagArray);
            setTagColors(colors || {});

            const activeTag = selectedTagRef.current;
            if (tagArray.length === 0) {
                setSelectedTag(null);
                setTagItems([]);
                return;
            }
            if (!activeTag || !tagArray.some(tag => tag.name === activeTag)) {
                loadTagItems(tagArray[0].name);
            }
        } catch (err) { console.error(err); }
        finally { setInitialLoading(false); }
    };

    const loadTagItems = async (tagName: string) => {
        setLoading(true);
        setSelectedTag(tagName);
        try {
            const items = await invoke<ClipboardEntry[]>('get_tag_items', { tag: tagName });
            setTagItems(items || []);
        } catch (err) { console.error(err); setTagItems([]); }
        finally { setLoading(false); }
    };

    const createTag = async (rawName: string) => {
        const trimmed = rawName.trim();
        if (!trimmed) return;

        try {
            await invoke('create_new_tag', { tagName: trimmed });
            setNewTagName('');
            setTagSearch('');
            await fetchTags();
            await loadTagItems(trimmed);
        } catch (err) { console.error(err); }
    };

    const handleRenameTag = async (oldName: string) => {
        const trimmed = newTagName.trim();
        if (!trimmed || trimmed === oldName) { setEditingTag(null); return; }

        if (oldName === 'sensitive' || oldName === '密码') {
            setEditingTag(null);
            return;
        }

        try {
            await invoke('rename_tag_globally', { oldName, newName: trimmed });
            if (selectedTag === oldName) setSelectedTag(trimmed);
            await fetchTags();
            await loadTagItems(trimmed);
            setEditingTag(null);
            setNewTagName('');
        } catch (err) { console.error(err); }
    };

    const handleDeleteTag = async (tagName: string) => {
        if (tagName === 'sensitive' || tagName === '密码') return;
        setIsDeleting(true);
        try {
            await invoke('delete_tag_from_all', { tagName });
            await emit('clipboard-changed'); // Notify App.tsx to refresh
            await fetchTags();
        } catch (err) { console.error(err); }
        finally {
            setIsDeleting(false);
        }
    };

    const handleAddManualItem = async () => {
        if (!newItemContent.trim() || !selectedTag) return;
        try {
            await invoke('add_manual_item', {
                content: newItemContent,
                contentType: 'text',
                tags: [selectedTag]
            });
            setNewItemContent('');
            setIsCreatingItem(false);
            await loadTagItems(selectedTag);
        } catch (err) { console.error(err); }
    };

    const handleUpdateItemContent = async () => {
        if (!editingItem || !editingItem.content.trim()) return;
        try {
            await invoke('update_item_content', {
                id: editingItem.id,
                newContent: editingItem.content
            });
            setEditingItem(null);
            if (selectedTag) await loadTagItems(selectedTag);
        } catch (err) { console.error(err); }
    };

    const copyToClipboard = async (id: number, content: string, type: string) => {
        try {
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            const invokeContent =
                id !== 0 && (type === "image" || type === "video" || type === "file")
                    ? ""
                    : content;
            await invoke('copy_to_clipboard', {
                content: invokeContent,
                contentType: type,
                paste: true,
                id,
                deleteAfterUse: false
            });
        } catch (err) { console.error(err); }
    };

    const openNoteEditor = (item: ClipboardEntry) => {
        ignoreNoteBlurRef.current = true;
        setEditingNoteId(item.id);
        setNoteDraft(item.note || '');
        requestAnimationFrame(() => {
            activateForInput()
                .catch(console.error)
                .finally(() => {
                    noteInputRef.current?.focus();
                    const el = noteInputRef.current;
                    if (el) {
                        const len = el.value.length;
                        el.setSelectionRange(len, len);
                    }
                    ignoreNoteBlurRef.current = false;
                });
        });
    };

    const cancelNoteEditor = () => {
        setEditingNoteId(null);
        setNoteDraft('');
    };

    const saveNote = async (id: number, note: string) => {
        const cleaned = note.trim();
        try {
            await invoke('update_entry_note', { id, note: cleaned });
            setTagItems((prev) =>
                prev.map((entry) => (entry.id === id ? { ...entry, note: cleaned } : entry))
            );
            setEditingNoteId(null);
            setNoteDraft('');
            emit('clipboard-changed');
        } catch (err) {
            console.error(err);
        }
    };

    const handleTagItemMouseDown = (e: ReactMouseEvent, item: ClipboardEntry) => {
        if (e.button !== 0 || isManageMode || isModalOpen || editingNoteId !== null) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, input, textarea, [role="button"], .card-note')) {
            return;
        }
        e.preventDefault();
        void copyToClipboard(item.id, item.content, item.content_type);
    };

    const filteredTags = useMemo(() => {
        return tags.filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()));
    }, [tags, tagSearch]);

    const normalizedTagSearch = tagSearch.trim().toLowerCase();
    const canCreateTag = normalizedTagSearch.length > 0
        && !tags.some(tag => tag.name.toLowerCase() === normalizedTagSearch);

    const sortedItems = [...tagItems].sort((a, b) => {
        if (sortBy === 'count') return (b.use_count || 0) - (a.use_count || 0);
        return (b.sort_at || b.timestamp) - (a.sort_at || a.timestamp);
    });

    const formatItemDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const isModalOpen =
        deleteConfirmation.show ||
        itemDeleteConfirmation.show ||
        isCreatingItem ||
        editingItem !== null;

    return (
        <div ref={pageRef} className={`tag-manager-page theme-${theme}`}>
            <div
                className={`tag-manager-body${isSplit ? " is-split" : ""}${isModalOpen ? " tag-manager-modal-open" : ""}`}
                style={isSplit ? { ["--tag-sidebar-width" as string]: `${sidebarWidth}px` } : undefined}
            >
                <div className="tag-manager-filter">
                    <div
                        className={`tag-manager-search-control${isTagSearchExpanded ? " is-open" : ""}`}
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !tagSearch.trim()) {
                                setIsTagSearchOpen(false);
                            }
                        }}
                    >
                        <button
                            ref={tagSearchButtonRef}
                            type="button"
                            className="tag-manager-search-trigger"
                            title={t("find_or_create")}
                            aria-label={t("find_or_create")}
                            aria-expanded={isTagSearchExpanded}
                            aria-controls={tagSearchInputId}
                            onClick={() => {
                                if (isTagSearchOpen) tagSearchInputRef.current?.focus();
                                else setIsTagSearchOpen(true);
                            }}
                        >
                            <Search size={14} aria-hidden="true" />
                        </button>
                        <input
                            id={tagSearchInputId}
                            ref={tagSearchInputRef}
                            className="search-input tag-manager-filter-search"
                            placeholder={t("find_or_create")}
                            aria-label={t("find_or_create")}
                            tabIndex={isTagSearchExpanded ? 0 : -1}
                            aria-hidden={!isTagSearchExpanded}
                            value={tagSearch}
                            onChange={(e) => setTagSearch(e.target.value)}
                            onKeyDown={async (e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    closeTagSearch();
                                    return;
                                }
                                if (e.nativeEvent.isComposing) return;
                                if (e.key === "Enter" && tagSearch.trim()) {
                                    const exactMatch = tags.find((tag) => tag.name.toLowerCase() === normalizedTagSearch);
                                    if (exactMatch) {
                                        loadTagItems(exactMatch.name);
                                    } else {
                                        await createTag(tagSearch);
                                    }
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="tag-manager-search-close"
                            title={t(isSplit ? "clear_tag_search" : "close")}
                            aria-label={t(isSplit ? "clear_tag_search" : "close")}
                            tabIndex={isTagSearchExpanded ? 0 : -1}
                            aria-hidden={!isTagSearchExpanded}
                            onClick={closeTagSearch}
                        >
                            <X size={12} aria-hidden="true" />
                        </button>
                    </div>
                    <div className="tag-manager-chip-row custom-scrollbar">
                        {filteredTags.map((tag) => {
                            const isSelected = selectedTag === tag.name;
                            const canEditTag = tag.name !== "sensitive" && tag.name !== "密码";
                            return (
                                <div
                                    key={tag.name}
                                    role="button"
                                    tabIndex={0}
                                    className={`tag-manager-chip${isSelected ? " active" : ""}${tagMenu?.name === tag.name ? " menu-open" : ""}`}
                                    onClick={() => loadTagItems(tag.name)}
                                    onKeyDown={(e) => {
                                        if (e.target !== e.currentTarget) return;
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            loadTagItems(tag.name);
                                        }
                                    }}
                                    title={`${tag.name} · ${tag.count}`}
                                >
                                    <div className="tag-color-wrapper">
                                        <button
                                            type="button"
                                            className="tag-color-dot"
                                            style={{ background: tagColors[tag.name] || getTagColor(tag.name, theme) }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                document.getElementById(`color-picker-${tag.name}`)?.click();
                                            }}
                                            aria-label={`${tag.name}: ${t("color_mode")}`}
                                            title={`${tag.name}: ${t("color_mode")}`}
                                        />
                                        <input
                                            type="color"
                                            id={`color-picker-${tag.name}`}
                                            style={{ display: "none" }}
                                            value={tagColors[tag.name] || "#888888"}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={async (e) => {
                                                const newColor = e.target.value;
                                                setTagColors((prev) => ({ ...prev, [tag.name]: newColor }));
                                                await invoke("set_tag_color", { name: tag.name, color: newColor });
                                                await emit("tag-colors-updated");
                                            }}
                                        />
                                    </div>
                                    {editingTag === tag.name ? (
                                        <input
                                            className="inline-tag-edit"
                                            value={newTagName}
                                            onChange={(e) => setNewTagName(e.target.value)}
                                            autoFocus
                                            onKeyDown={async (e) => {
                                                if (e.key === "Enter") {
                                                    await handleRenameTag(tag.name);
                                                } else if (e.key === "Escape") {
                                                    setEditingTag(null);
                                                }
                                            }}
                                            onBlur={() => setEditingTag(null)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <span className="tag-manager-chip-name">{tag.name}</span>
                                            <span className="tag-manager-chip-count">{tag.count}</span>
                                            {isSelected && canEditTag && (
                                                <span className="tag-target-actions">
                                                    <button
                                                        type="button"
                                                        className="tag-target-action-btn"
                                                        title={t("tag_actions")}
                                                        aria-label={`${tag.name}: ${t("tag_actions")}`}
                                                        aria-haspopup="menu"
                                                        aria-expanded={tagMenu?.name === tag.name}
                                                        aria-controls={tagMenu?.name === tag.name ? tagMenuId : undefined}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (tagMenu?.name === tag.name) {
                                                                setTagMenu(null);
                                                                return;
                                                            }
                                                            tagMenuTriggerRef.current = e.currentTarget;
                                                            const bounds = e.currentTarget.getBoundingClientRect();
                                                            setTagMenu({
                                                                name: tag.name,
                                                                left: Math.max(8, Math.min(bounds.left, window.innerWidth - 152)),
                                                                top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 88)),
                                                            });
                                                        }}
                                                    >
                                                        <Ellipsis size={13} />
                                                    </button>
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                        {canCreateTag && (
                            <button
                                type="button"
                                className="tag-manager-chip is-create"
                                onClick={() => createTag(tagSearch)}
                            >
                                <Plus size={12} />
                                <span className="tag-manager-chip-name">
                                    {t("create_tag_hint").replace("{tag}", tagSearch.trim())}
                                </span>
                            </button>
                        )}
                        {!initialLoading && filteredTags.length === 0 && !tagSearch.trim() && (
                            <span className="tag-manager-chip-empty">{t("no_tags")}</span>
                        )}
                    </div>
                </div>

                {isSplit && (
                    <div
                        className={`tag-manager-divider${isResizing ? " active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setIsResizing(true);
                        }}
                    >
                        <span className="tag-manager-divider-handle" />
                    </div>
                )}

                <div className="advanced-editor tag-manager-editor">
                    <div className="advanced-editor-toolbar">
                        <div className="advanced-editor-heading">
                            <div className="advanced-editor-title">
                                {selectedTag
                                    ? `#${selectedTag} · ${sortedItems.length}`
                                    : t("tags")}
                            </div>
                        </div>

                        <div className="advanced-editor-actions tag-manager-toolbar-actions">
                            {selectedTag && (
                                <>
                                    {isManageMode ? (
                                        <>
                                            <button
                                                type="button"
                                                className="tag-manager-sort-btn"
                                                onClick={() => {
                                                    setIsManageMode(false);
                                                    setSelectedItemIds(new Set());
                                                }}
                                            >
                                                {t("cancel") || "取消"}
                                            </button>
                                            <button
                                                type="button"
                                                className="tag-manager-sort-btn danger"
                                                disabled={selectedItemIds.size === 0}
                                                onClick={() => setItemDeleteConfirmation({ show: true, id: -1 })}
                                            >
                                                <Trash2 size={14} />
                                                <span>{t("delete_selected") || "删除选中"}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="tag-manager-sort-btn active"
                                                disabled={selectedItemIds.size === 0}
                                                onClick={async () => {
                                                    const selectedItems = tagItems.filter((item) => selectedItemIds.has(item.id));
                                                    if (selectedItems.length > 0) {
                                                        const combinedContent = selectedItems.map((item) => item.content).join("\n");
                                                        await invoke("copy_to_clipboard", {
                                                            content: combinedContent,
                                                            contentType: "text",
                                                            paste: true,
                                                            id: -1,
                                                            deleteAfterUse: false
                                                        });
                                                        setIsManageMode(false);
                                                        setSelectedItemIds(new Set());
                                                    }
                                                }}
                                            >
                                                <Copy size={14} />
                                                <span>{t("copy_selected") || "复制选中"}</span>
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            className={`tag-manager-sort-btn ${isManageMode ? "active" : ""}`}
                                            onClick={() => setIsManageMode(true)}
                                            title={t("manage_items") || "管理条目"}
                                        >
                                            <CheckSquare size={14} />
                                            <span>{t("manage") || "管理"}</span>
                                        </button>
                                    )}
                                </>
                            )}
                            <div className="tag-manager-sort-group">
                                <button
                                    type="button"
                                    className={`tag-manager-sort-btn ${sortBy === "time" ? "active" : ""}`}
                                    title={t("sort_time") || "按时间"}
                                    onClick={() => setSortBy("time")}
                                >
                                    <Clock size={12} />
                                    <span>{t("sort_time") || "时间"}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`tag-manager-sort-btn ${sortBy === "count" ? "active" : ""}`}
                                    title={t("sort_usage") || "按频率"}
                                    onClick={() => setSortBy("count")}
                                >
                                    <MousePointer2 size={12} />
                                    <span>{t("sort_usage") || "频率"}</span>
                                </button>
                            </div>
                            <div className="tag-manager-view-toggle">
                                <button
                                    type="button"
                                    className={`toggle-btn ${viewMode === "list" ? "active" : ""}`}
                                    title={t("list_view")}
                                    onClick={() => setViewMode("list")}
                                >
                                    <List size={14} />
                                </button>
                                <button
                                    type="button"
                                    className={`toggle-btn ${viewMode === "grid" ? "active" : ""}`}
                                    title={t("grid_view")}
                                    onClick={() => setViewMode("grid")}
                                >
                                    <LayoutGrid size={14} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div
                        className={
                            loading || initialLoading || sortedItems.length > 0
                                ? `advanced-rule-list tag-manager-items custom-scrollbar${loading || initialLoading ? " is-empty" : ""}${isManageMode ? " manage-mode" : ""}`
                                : "tag-manager-empty-panel"
                        }
                    >
                        {loading || initialLoading ? (
                            <div className="tag-manager-status">{t("processing")}</div>
                        ) : sortedItems.length === 0 ? (
                            <div className="tag-manager-empty-state">
                                <div className="tag-manager-empty-title">
                                    {selectedTag ? t("no_items") : t("tags")}
                                </div>
                                <div className="tag-manager-empty-text">
                                    {selectedTag ? t("select_tag") : t("select_tag_to_begin")}
                                </div>
                            </div>
                        ) : (
                            <div className={`items-${viewMode}`}>
                                {sortedItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`tag-manager-card ${selectedItemIds.has(item.id) ? "selected" : ""}`}
                                        data-tag-item-id={String(item.id)}
                                        data-tag-item-type={item.content_type}
                                        onMouseDownCapture={(e) => handleTagItemMouseDown(e, item)}
                                        onClick={() => {
                                            if (isModalOpen) return;
                                            if (isManageMode) {
                                                setSelectedItemIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(item.id)) next.delete(item.id);
                                                    else next.add(item.id);
                                                    return next;
                                                });
                                            }
                                        }}
                                    >
                                        <div className="card-top-row">
                                            <div className="card-actions-left">
                                                {isManageMode ? (
                                                    <div className={`selection-indicator ${selectedItemIds.has(item.id) ? "checked" : ""}`}>
                                                        <div className="inner-check" />
                                                    </div>
                                                ) : (
                                                    <>
                                                        {(item.content_type === "text" || item.content_type === "code") && (
                                                            <button
                                                                className="card-action-btn"
                                                                title="编辑"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingItem({ id: item.id, content: item.content });
                                                                }}
                                                            >
                                                                <Edit2 size={10} />
                                                            </button>
                                                        )}
                                                        <button
                                                            className={`card-action-btn${item.note || editingNoteId === item.id ? " active" : ""}`}
                                                            title={item.note ? (t("edit_note") || "编辑备注") : (t("add_note") || "添加备注")}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (editingNoteId === item.id) {
                                                                    void saveNote(item.id, noteDraft);
                                                                } else {
                                                                    openNoteEditor(item);
                                                                }
                                                            }}
                                                        >
                                                            <StickyNote size={10} />
                                                        </button>
                                                        <button
                                                            className="card-action-btn"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                invoke("open_content", {
                                                                    id: item.id,
                                                                    content: item.content,
                                                                    contentType: item.content_type
                                                                });
                                                            }}
                                                            title={t("open")}
                                                        >
                                                            <ExternalLink size={10} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            {!isManageMode && (
                                                <button
                                                    className="del-btn"
                                                    title="删除"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setItemDeleteConfirmation({ show: true, id: item.id });
                                                    }}
                                                >
                                                    <X size={10} />
                                                </button>
                                            )}
                                        </div>

                                        {item.content_type === "image" ? (
                                            <div className="card-media">
                                                <img
                                                    src={
                                                        withImageCacheBust(
                                                            item.content.startsWith("data:")
                                                                ? item.content
                                                                : (toTauriLocalImageSrc(item.content) || convertFileSrc(item.content)),
                                                            item.timestamp
                                                        ) || ""
                                                    }
                                                    alt=""
                                                    className="image-preview"
                                                    loading="lazy"
                                                />
                                            </div>
                                        ) : (
                                            <div className="card-body-text">{item.preview || item.content}</div>
                                        )}

                                        {(editingNoteId === item.id || !!item.note) && (
                                            <div
                                                className={`card-note${editingNoteId === item.id ? " editing" : ""}`}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {editingNoteId === item.id ? (
                                                    <textarea
                                                        ref={noteInputRef}
                                                        className="card-note-input"
                                                        value={noteDraft}
                                                        placeholder={getNotePlaceholder(t)}
                                                        rows={2}
                                                        onMouseDown={(e) => {
                                                            e.stopPropagation();
                                                        }}
                                                        onChange={(e) => setNoteDraft(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Escape") {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                cancelNoteEditor();
                                                                return;
                                                            }
                                                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                void saveNote(item.id, noteDraft);
                                                            }
                                                        }}
                                                        onBlur={() => {
                                                            if (ignoreNoteBlurRef.current) return;
                                                            window.setTimeout(() => {
                                                                if (ignoreNoteBlurRef.current) return;
                                                                const active = document.activeElement;
                                                                if (active && noteInputRef.current?.closest(".card-note")?.contains(active)) {
                                                                    return;
                                                                }
                                                                void saveNote(item.id, noteInputRef.current?.value ?? noteDraft);
                                                            }, 0);
                                                        }}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="card-note-text"
                                                        title={item.note}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openNoteEditor(item);
                                                        }}
                                                    >
                                                        <StickyNote size={11} className="card-note-icon" aria-hidden />
                                                        <span>{item.note}</span>
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        <div className="card-divider" />
                                        <div className="card-footer">
                                            <span className="meta-time">
                                                {formatItemDate(item.created_at || item.timestamp)}
                                            </span>
                                            <div className="meta-usage">
                                                <MousePointer2 size={8} /> {item.use_count || 0}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    {selectedTag && !isManageMode && (
                        <button
                            type="button"
                            className="btn-icon tag-manager-fab-add-btn"
                            onClick={() => setIsCreatingItem(true)}
                            title={t("add_item")}
                        >
                            <Plus size={18} />
                        </button>
                    )}
                </div>
            </div>

            {tagMenu && createPortal(
                <div
                    ref={tagMenuRef}
                    id={tagMenuId}
                    role="menu"
                    aria-label={t("tag_actions")}
                    className="tag-manager-action-menu"
                    style={{ left: tagMenu.left, top: tagMenu.top }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape' || e.key === 'Tab') {
                            e.preventDefault();
                            e.stopPropagation();
                            setTagMenu(null);
                            tagMenuTriggerRef.current?.focus();
                        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                            e.preventDefault();
                            e.stopPropagation();
                            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
                                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                            buttons[next]?.focus();
                        }
                    }}
                >
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            const name = tagMenu.name;
                            setTagMenu(null);
                            void activateForInput().catch(console.error).finally(() => {
                                setNewTagName(name);
                                setEditingTag(name);
                            });
                        }}
                    >
                        <Edit2 size={13} aria-hidden="true" />
                        {t("rename")}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                            setDeleteConfirmation({ show: true, tagName: tagMenu.name });
                            setTagMenu(null);
                        }}
                    >
                        <Trash2 size={13} aria-hidden="true" />
                        {t("delete")}
                    </button>
                </div>,
                document.body
            )}

            <AppModal
                open={deleteConfirmation.show}
                onClose={() => setDeleteConfirmation({ show: false, tagName: null })}
                theme={theme}
                panelClassName="modal-panel confirm-dialog"
                ariaLabel={t("confirm_delete")}
            >
                <h3 className="confirm-dialog-title">{t("confirm_delete")}</h3>
                <p className="confirm-dialog-message">
                    {t("confirm_delete_tag")}
                    <br />
                    <span className="tag-highlight" style={{ marginTop: "8px", display: "inline-block" }}>
                        {deleteConfirmation.tagName}
                    </span>
                </p>
                <div className="confirm-dialog-buttons">
                    <button type="button" className="modal-button" onClick={() => setDeleteConfirmation({ show: false, tagName: null })}>
                        {t("cancel")}
                    </button>
                    <button
                        type="button"
                        className="modal-button primary"
                        onClick={() => {
                            if (deleteConfirmation.tagName) {
                                handleDeleteTag(deleteConfirmation.tagName);
                            }
                            setDeleteConfirmation({ show: false, tagName: null });
                        }}
                    >
                        {t("delete")}
                    </button>
                </div>
            </AppModal>

            <AppModal
                open={itemDeleteConfirmation.show}
                onClose={() => setItemDeleteConfirmation({ show: false, id: null })}
                theme={theme}
                panelClassName="modal-panel confirm-dialog"
                ariaLabel={t("confirm_delete")}
            >
                <h3 className="confirm-dialog-title">{t("confirm_delete")}</h3>
                <p className="confirm-dialog-message">{t("confirm_delete_desc") || "确定要删除这条记录吗？"}</p>
                <div className="confirm-dialog-buttons">
                    <button type="button" className="modal-button" onClick={() => setItemDeleteConfirmation({ show: false, id: null })}>
                        {t("cancel")}
                    </button>
                    <button
                        type="button"
                        className="modal-button primary"
                        onClick={async () => {
                            if (itemDeleteConfirmation.id === -1) {
                                try {
                                    for (const id of Array.from(selectedItemIds)) {
                                        await invoke("delete_clipboard_entry", { id });
                                    }
                                    setIsManageMode(false);
                                    setSelectedItemIds(new Set());
                                    if (selectedTag) await loadTagItems(selectedTag);
                                    emit("clipboard-changed");
                                } catch (err) {
                                    console.error(err);
                                }
                            } else if (itemDeleteConfirmation.id) {
                                await invoke("delete_clipboard_entry", { id: itemDeleteConfirmation.id });
                                loadTagItems(selectedTag!);
                                emit("clipboard-changed");
                            }
                            setItemDeleteConfirmation({ show: false, id: null });
                        }}
                    >
                        {t("delete")}
                    </button>
                </div>
            </AppModal>

            <AppModal
                open={isCreatingItem}
                onClose={() => setIsCreatingItem(false)}
                theme={theme}
                panelClassName="modal-panel modal-form-dialog tag-add-dialog"
                ariaLabel={t("add_item")}
            >
                <div className="modal-form-heading">
                    <div className="tag-add-dialog-heading">
                        <h3 className="modal-form-title tag-add-dialog-title">{t("add_item")}</h3>
                        {selectedTag && (
                            <p className="modal-form-subtitle tag-add-dialog-tag">
                                {t("add_item_destination").replace("{tag}", selectedTag)}
                            </p>
                        )}
                    </div>
                </div>
                <textarea
                    className="modal-form-control modal-textarea"
                    value={newItemContent}
                    onChange={(e) => setNewItemContent(e.target.value)}
                    placeholder={t("input_content_placeholder")}
                    aria-label={t("input_content_placeholder")}
                    rows={5}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void handleAddManualItem();
                        }
                    }}
                    autoFocus
                />
                <div className="modal-form-actions tag-add-dialog-actions">
                    <button type="button" className="modal-button" onClick={() => setIsCreatingItem(false)}>
                        {t("cancel")}
                    </button>
                    <button
                        type="button"
                        className="modal-button primary"
                        onClick={handleAddManualItem}
                        disabled={!newItemContent.trim()}
                    >
                        {t("add_item_action")}
                    </button>
                </div>
            </AppModal>

            <AppModal
                open={Boolean(editingItem)}
                onClose={() => setEditingItem(null)}
                theme={theme}
                panelClassName="modal-panel modal-form-dialog tag-edit-dialog"
                ariaLabel={t("edit_item")}
            >
                {editingItem && (
                    <>
                        <div className="modal-form-heading">
                            <h3 className="modal-form-title">{t("edit_item")}</h3>
                        </div>
                        <textarea
                            className="modal-form-control modal-textarea"
                            value={editingItem.content}
                            onChange={(e) => setEditingItem({ ...editingItem, content: e.target.value })}
                            autoFocus
                        />
                        <div className="modal-form-actions">
                            <button type="button" className="modal-button" onClick={() => setEditingItem(null)}>
                                {t("cancel")}
                            </button>
                            <button type="button" className="modal-button primary" onClick={handleUpdateItemContent}>
                                {t("save")}
                            </button>
                        </div>
                    </>
                )}
            </AppModal>
        </div>
    );
}
