import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent, ClipboardEvent } from "react";
import {
    Plus,
    Maximize2,
    Minimize2,
    ArrowUp,
    LoaderCircle,
    FileArchive,
    File as FileIcon,
    FolderOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { MultiFileSendMode } from "../utils/transferHelpers";

interface TransferComposerProps {
    input: string;
    setInput: (value: string | ((prev: string) => string)) => void;
    onSend: () => void;
    multiFileSendMode: MultiFileSendMode;
    onSelectMultiFileSendMode: (mode: MultiFileSendMode) => void;
    chooseFilesToSend: (mode?: MultiFileSendMode) => Promise<void>;
    isChoosingFiles: boolean;
    t?: (key: string) => string;
}

export const TransferComposer = ({
    input,
    setInput,
    onSend,
    multiFileSendMode,
    onSelectMultiFileSendMode,
    chooseFilesToSend,
    isChoosingFiles,
    t,
}: TransferComposerProps) => {
    const composerMinHeight = 36;
    const [showFullScreen, setShowFullScreen] = useState(false);
    const [showExpandBtn, setShowExpandBtn] = useState(false);
    const [showFileSendOptions, setShowFileSendOptions] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileSendOptionsRef = useRef<HTMLDivElement>(null);

    // Auto-adjust textarea height
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = `${composerMinHeight}px`;
            const scrollHeight = textareaRef.current.scrollHeight;

            if (scrollHeight > 120) {
                setShowExpandBtn(true);
            } else {
                setShowExpandBtn(false);
            }

            textareaRef.current.style.height =
                Math.min(Math.max(composerMinHeight, scrollHeight), 120) + "px";
        }
    }, [input]);

    // Click outside to dismiss file options dropdown
    useEffect(() => {
        if (!showFileSendOptions) return;
        const closeOptions = (event: globalThis.MouseEvent) => {
            if (!fileSendOptionsRef.current?.contains(event.target as Node)) {
                setShowFileSendOptions(false);
            }
        };
        window.addEventListener("pointerdown", closeOptions);
        return () => window.removeEventListener("pointerdown", closeOptions);
    }, [showFileSendOptions]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
        if (e.clipboardData.files.length > 0) {
            const files = Array.from(e.clipboardData.files);
            const imageFiles = files.filter((f) => f.type.startsWith("image/"));

            if (imageFiles.length > 0) {
                e.preventDefault();

                for (const file of imageFiles) {
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        const base64 = ev.target?.result as string;
                        if (base64) {
                            try {
                                const savedPath = await invoke<string>("save_temp_image", { base64Data: base64 });
                                await invoke("send_file_to_client", { filePath: savedPath });
                            } catch (err) {
                                console.error("Failed to paste image", err);
                            }
                        }
                    };
                    reader.readAsDataURL(file);
                }
            }
        }
    };

    const handleSend = () => {
        if (!input.trim()) return;
        onSend();
        setShowFullScreen(false);
        if (textareaRef.current) {
            textareaRef.current.style.height = `${composerMinHeight}px`;
        }
    };

    return (
        <>
            <div className="wt-footer">
                <div className="wt-composer">
                    {/* Attachment control with TieZ standard btn-icon */}
                    <div className="wt-file-send-control" ref={fileSendOptionsRef}>
                        <button
                            type="button"
                            className={`btn-icon wt-composer-add-btn ${showFileSendOptions ? "active" : ""}`}
                            title="选择与发送文件"
                            aria-label="选择与发送文件"
                            aria-expanded={showFileSendOptions}
                            disabled={isChoosingFiles}
                            onClick={() => setShowFileSendOptions((value) => !value)}
                        >
                            {isChoosingFiles ? (
                                <LoaderCircle size={15} className="wt-spin" />
                            ) : (
                                <Plus size={15} />
                            )}
                        </button>

                        <AnimatePresence>
                            {showFileSendOptions && (
                                <motion.div
                                    className="wt-file-send-options"
                                    role="menu"
                                    initial={{ opacity: 0, scale: 0.96, y: 4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.96, y: 4 }}
                                    transition={{ duration: 0.12 }}
                                >
                                    <button
                                        type="button"
                                        className="wt-file-send-option-primary"
                                        role="menuitem"
                                        onClick={() => {
                                            setShowFileSendOptions(false);
                                            void chooseFilesToSend();
                                        }}
                                    >
                                        <FolderOpen size={15} />
                                        <span>
                                            <strong>选择文件发送…</strong>
                                            <small>从访达或本地目录选取</small>
                                        </span>
                                    </button>

                                    <div className="wt-menu-divider" role="separator" />

                                    <div className="wt-menu-section-label">多文件发送模式</div>

                                    <button
                                        type="button"
                                        className={multiFileSendMode === "package" ? "is-active" : ""}
                                        role="menuitemradio"
                                        aria-checked={multiFileSendMode === "package"}
                                        onClick={() => {
                                            onSelectMultiFileSendMode("package");
                                            setShowFileSendOptions(false);
                                        }}
                                    >
                                        <FileArchive size={15} />
                                        <span>
                                            <strong>作为文件包发送</strong>
                                            <small>多文件自动折叠，支持整包保存</small>
                                        </span>
                                        {multiFileSendMode === "package" && (
                                            <span className="wt-option-check">✓</span>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        className={multiFileSendMode === "separate" ? "is-active" : ""}
                                        role="menuitemradio"
                                        aria-checked={multiFileSendMode === "separate"}
                                        onClick={() => {
                                            onSelectMultiFileSendMode("separate");
                                            setShowFileSendOptions(false);
                                        }}
                                    >
                                        <FileIcon size={15} />
                                        <span>
                                            <strong>逐个独立发送</strong>
                                            <small>每个文件作为单独卡片发送</small>
                                        </span>
                                        {multiFileSendMode === "separate" && (
                                            <span className="wt-option-check">✓</span>
                                        )}
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* TieZ Native Input Field */}
                    <div className="wt-input-wrapper">
                        <textarea
                            ref={textareaRef}
                            className="wt-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={t ? t("type_message") || "输入消息或拖入文件…" : "输入消息或拖入文件…"}
                            rows={1}
                        />

                        {showExpandBtn && (
                            <button
                                type="button"
                                className="btn-icon wt-input-expand-btn"
                                onClick={() => setShowFullScreen(true)}
                                title="展开全屏编辑"
                                aria-label="展开全屏编辑"
                            >
                                <Maximize2 size={13} />
                            </button>
                        )}
                    </div>

                    {/* Send Button */}
                    <button
                        type="button"
                        className={`btn-icon wt-send-btn ${input.trim() ? "active" : ""}`}
                        disabled={!input.trim()}
                        onClick={handleSend}
                        title="发送 (Enter)"
                        aria-label="发送消息"
                    >
                        <ArrowUp size={15} />
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {showFullScreen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="wt-fullscreen-editor"
                    >
                        <div className="wt-fullscreen-header">
                            <div className="wt-fullscreen-title">编辑消息</div>
                            <button
                                onClick={() => setShowFullScreen(false)}
                                className="wt-overlay-icon-btn"
                                title="收起编辑器"
                                aria-label="收起编辑器"
                            >
                                <Minimize2 size={16} />
                            </button>
                        </div>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="输入消息…"
                            className="wt-fullscreen-textarea"
                            onPaste={handlePaste}
                        />

                        <div className="wt-fullscreen-footer">
                            <button
                                onClick={() => setShowFullScreen(false)}
                                className="wt-btn"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSend}
                                className="wt-btn send"
                            >
                                发送
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
