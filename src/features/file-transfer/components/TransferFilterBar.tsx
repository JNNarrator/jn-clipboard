import { motion, AnimatePresence } from "framer-motion";
import { Search, X } from "lucide-react";
import type { FileTransferFilterType } from "../types";

export interface TransferFilterBarProps {
    showSearchBar: boolean;
    filterType: FileTransferFilterType;
    onSelectFilterType: (type: FileTransferFilterType) => void;
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
    isFiltering: boolean;
    filteredCount: number;
}

export const TransferFilterBar = ({
    showSearchBar,
    filterType,
    onSelectFilterType,
    searchQuery,
    onSearchQueryChange,
    searchInputRef,
    isFiltering,
    filteredCount,
}: TransferFilterBarProps) => {
    return (
        <AnimatePresence>
            {showSearchBar && (
                <motion.div
                    className="wt-filter-bar"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                >
                    <div className="wt-filter-bar-inner">
                        <div className="wt-filter-pills" role="tablist">
                            {(
                                [
                                    { id: 'all', label: '全部' },
                                    { id: 'file', label: '文件' },
                                    { id: 'media', label: '媒体' },
                                    { id: 'text', label: '文本' },
                                ] as const
                            ).map(pill => (
                                <button
                                    key={pill.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={filterType === pill.id}
                                    className={`wt-filter-pill ${filterType === pill.id ? 'is-active' : ''}`}
                                    onClick={() => onSelectFilterType(pill.id)}
                                >
                                    {pill.label}
                                </button>
                            ))}
                        </div>

                        <div className="wt-filter-search-wrap">
                            <div className="wt-search-input-box">
                                <Search size={13} className="wt-search-icon" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    className="wt-search-input"
                                    placeholder="搜索记录、文件名..."
                                    value={searchQuery}
                                    onChange={(e) => onSearchQueryChange(e.target.value)}
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        className="wt-search-clear-btn"
                                        onClick={() => {
                                            onSearchQueryChange('');
                                            searchInputRef.current?.focus();
                                        }}
                                        title="清除搜索"
                                        aria-label="清除搜索"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>

                            {isFiltering && (
                                <div className="wt-filter-badge">
                                    {filteredCount} 条
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
