import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent, ClipboardEvent } from "react";
import {
    Plus,
    Maximize2,
    Minimize2,
    Send,
    LoaderCircle,
    ChevronDown,
    FileArchive,
    File as FileIcon,
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
    const composerMinHeight = 22;
    const [showFullScreen, setShowFullScreen] = useState(false);
    const [showExpandBtn, setShowExpandBtn] = useState(false);
    const [showFileSendOptions, setShowFileSendOptions] = useState(false);
    const [isMultiLine, setIsMultiLine] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileSendOptionsRef = useRef<HTMLDivElement>(null);

    // Auto-adjust textarea height
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        // When input is empty, strictly enforce single line
        if (!input) {
            textarea.style.height = `${composerMinHeight}px`;
            setIsMultiLine(false);
            setShowExpandBtn(false);
            return;
        }

        // Reset to minimum height to read scrollHeight accurately
        textarea.style.height = `${composerMinHeight}px`;
        const scrollHeight = textarea.scrollHeight;

        const multiLine = input.includes("\n") || scrollHeight > 35;
        setIsMultiLine(multiLine);

        if (multiLine) {
            const targetHeight = Math.min(Math.max(scrollHeight, composerMinHeight), 120);
            textarea.style.height = `${targetHeight}px`;
            setShowExpandBtn(scrollHeight > 120);
        } else {
            textarea.style.height = `${composerMinHeight}px`;
            setShowExpandBtn(false);
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
        setIsMultiLine(false);
        if (textareaRef.current) {
            textareaRef.current.style.height = `${composerMinHeight}px`;
        }
    };

    return (
        <>
            <div className="wt-footer">
                <div className="wt-composer">
                    <div className="wt-file-send-control" ref={fileSendOptionsRef}>
                        <button
                            type="button"
                            className="wt-btn-icon wt-file-send-main"
                            title={
                                isChoosingFiles
                                    ? "正在打开文件选择器"
                                    : multiFileSendMode === "package"
                                        ? "发送文件（多文件组成文件包）"
                                        : "发送文件（多文件分别发送）"
                            }
                            aria-label={isChoosingFiles ? "正在打开文件选择器" : "发送文件"}
                            disabled={isChoosingFiles}
                            onClick={() => void chooseFilesToSend()}
                        >
                            {isChoosingFiles ? (
                                <LoaderCircle size={18} className="wt-spin" />
                            ) : (
                                <Plus size={18} />
                            )}
                        </button>
                        <button
                            type="button"
                            className="wt-file-send-toggle"
                            aria-label="选择多文件发送方式"
                            aria-expanded={showFileSendOptions}
                            disabled={isChoosingFiles}
                            onClick={() => setShowFileSendOptions((value) => !value)}
                        >
                            <ChevronDown size={12} />
                        </button>
                        {showFileSendOptions && (
                            <div className="wt-file-send-options" role="menu">
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
                                    <FileArchive size={17} />
                                    <span>
                                        <strong>作为文件包发送</strong>
                                        <small>多文件折叠显示，可整包保存</small>
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
                                    <FileIcon size={17} />
                                    <span>
                                        <strong>分别发送</strong>
                                        <small>每个文件独立显示</small>
                                    </span>
                                    {multiFileSendMode === "separate" && (
                                        <span className="wt-option-check">✓</span>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className={`wt-input-wrap ${isMultiLine ? "is-multiline" : ""}`}>
                        <textarea
                            ref={textareaRef}
                            className="wt-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={t ? t("type_message") || "Type a message..." : "Type..."}
                            rows={1}
                        />
                    </div>

                    {showExpandBtn && (
                        <button
                            type="button"
                            className="wt-btn-icon"
                            onClick={() => setShowFullScreen(true)}
                            title="展开编辑"
                            aria-label="展开编辑"
                        >
                            <Maximize2 size={16} />
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={handleSend}
                        className="wt-btn send"
                        disabled={!input.trim()}
                        title="发送消息"
                        aria-label="发送消息"
                    >
                        <Send size={18} />
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
