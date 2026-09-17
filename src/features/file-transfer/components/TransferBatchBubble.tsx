import type { MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronRight, FileArchive, Folder } from "lucide-react";
import type { FileTransferMessage, FileTransferContextMenu } from "../types";
import {
    TransferFileTypeIcon,
    getTransferFileName,
    getTransferFileIconPath,
    formatTransferBytes,
    isLocalTransferPath,
} from "../utils/transferHelpers";

export interface TransferBatchBubbleProps {
    message: FileTransferMessage;
    batchMessages: FileTransferMessage[];
    expanded: boolean;
    onToggleExpand: (batchId: string) => void;
    onOpenContent: (target: { filePath?: string; content?: string; type?: string }) => void;
    onSaveBatchAs: (batchMessages: FileTransferMessage[]) => void;
    isSaving: boolean;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>, menu: Omit<FileTransferContextMenu, 'x' | 'y'>) => void;
}

export const TransferBatchBubble = ({
    message: m,
    batchMessages,
    expanded,
    onToggleExpand,
    onOpenContent,
    onSaveBatchAs,
    isSaving,
    onContextMenu,
}: TransferBatchBubbleProps) => {
    const batchId = m.batch_id!;
    const availableCount = batchMessages.filter(message =>
        !!message.file_path && isLocalTransferPath(message.file_path)
    ).length;
    const totalSize = m.batch_size
        || batchMessages.reduce((total, message) => total + (message.file_size || 0), 0);

    return (
        <div
            className="wt-bubble wt-bubble-file wt-batch-bubble"
            onContextMenu={(event) => onContextMenu(event, {
                type: 'batch',
                batchId,
                batchMessages
            })}
        >
            {m.sender_name && m.direction === 'in' && (
                <div className="wt-sender-name">{m.sender_name}</div>
            )}
            <button
                type="button"
                className="wt-batch-header"
                onClick={() => onToggleExpand(batchId)}
                aria-expanded={expanded}
            >
                <span className="wt-batch-icon"><FileArchive size={24} /></span>
                <span className="wt-batch-summary">
                    <strong>{m.batch_name || `${m.batch_total || batchMessages.length} 个文件`}</strong>
                    <small>
                        {m.batch_total || batchMessages.length} 个文件
                        {totalSize > 0 ? ` · ${formatTransferBytes(totalSize)}` : ''}
                    </small>
                </span>
                {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            </button>
            {expanded && (
                <div className="wt-batch-files">
                    {batchMessages.map(fileMessage => (
                        <button
                            type="button"
                            className="wt-batch-file"
                            key={fileMessage.id}
                            disabled={fileMessage._preparing}
                            onClick={() => {
                                if (fileMessage._preparing) return;
                                onOpenContent({
                                    filePath: fileMessage.file_path,
                                    content: fileMessage.content,
                                    type: fileMessage.msg_type
                                });
                            }}
                        >
                            <TransferFileTypeIcon
                                filePath={getTransferFileIconPath(fileMessage)}
                                fileName={getTransferFileName(fileMessage)}
                                preparing={fileMessage._preparing}
                            />
                            <span>
                                <strong>{getTransferFileName(fileMessage)}</strong>
                                <small>
                                    {fileMessage._error
                                        ? fileMessage._error
                                        : fileMessage._preparing && fileMessage._progress !== undefined
                                            ? `${fileMessage._progress}% ${fileMessage._speed ? `· ${fileMessage._speed}` : ''}`
                                            : (formatTransferBytes(fileMessage.file_size) || (fileMessage._preparing ? '准备中…' : '点击打开'))}
                                </small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <div className="wt-batch-actions">
                <span>{availableCount}/{m.batch_total || batchMessages.length} 可用</span>
                <button
                    type="button"
                    disabled={isSaving || availableCount !== batchMessages.length}
                    onClick={() => onSaveBatchAs(batchMessages)}
                >
                    <Folder size={13} />
                    {isSaving ? '正在保存…' : '整包另存为'}
                </button>
            </div>
        </div>
    );
};
