import { QRCodeCanvas } from "qrcode.react";
import {
    ChevronDown,
    FolderOpen,
    Trash2,
    QrCode,
    Search,
    Link as LinkIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { NetworkInterfaceInfo } from "../types";

export interface TransferHeaderProps {
    hasOnlineDevices: boolean;
    conversationTitle: string;
    onlineDevicesCount: number;
    connectionUrl: string;
    activeIp: string;
    actualPort: string;
    selectedIp: string;
    interfaces: NetworkInterfaceInfo[];
    onSwitchIp: (ip: string) => void;
    copiedLink: boolean;
    onCopyLink: (url: string) => void;
    showSearchBar: boolean;
    isFiltering: boolean;
    onToggleSearch: () => void;
    onOpenFolder: () => void;
    hasMessages: boolean;
    onClearHistory: () => void;
    showQrCode: boolean;
    onToggleQrCode: () => void;
}

export const TransferHeader = ({
    hasOnlineDevices,
    conversationTitle,
    onlineDevicesCount,
    connectionUrl,
    activeIp,
    actualPort,
    selectedIp,
    interfaces,
    onSwitchIp,
    copiedLink,
    onCopyLink,
    showSearchBar,
    isFiltering,
    onToggleSearch,
    onOpenFolder,
    hasMessages,
    onClearHistory,
    showQrCode,
    onToggleQrCode,
}: TransferHeaderProps) => {
    return (
        <div className="wt-sub-toolbar">
            {/* Left: Minimal status indicator */}
            <div className="wt-toolbar-left">
                <button
                    type="button"
                    className="wt-status-pill"
                    onClick={onToggleQrCode}
                    title="点击查看连接二维码与网卡地址"
                >
                    <span
                        className={`wt-status-dot ${hasOnlineDevices ? "is-online" : "is-waiting"}`}
                        aria-hidden="true"
                    />
                    <span className="wt-status-text">
                        {hasOnlineDevices
                            ? (onlineDevicesCount === 1 ? (conversationTitle || "设备已连接") : `${onlineDevicesCount} 台设备在线`)
                            : `${activeIp}:${actualPort}`}
                    </span>
                </button>
            </div>

            {/* Right: Standard TieZ btn-icon actions */}
            <div className="wt-toolbar-actions">
                <button
                    type="button"
                    className={`btn-icon ${showSearchBar || isFiltering ? "active" : ""}`}
                    title={showSearchBar ? "关闭搜索与筛选" : "搜索与筛选记录"}
                    aria-label="搜索与筛选"
                    onClick={onToggleSearch}
                >
                    <Search size={14} />
                </button>

                <button
                    type="button"
                    className="btn-icon"
                    title="在访达中打开保存目录"
                    aria-label="打开保存目录"
                    onClick={onOpenFolder}
                >
                    <FolderOpen size={14} />
                </button>

                <button
                    type="button"
                    className={`btn-icon ${showQrCode ? "active" : ""}`}
                    title="连接二维码与地址"
                    aria-label="连接二维码与地址"
                    aria-expanded={showQrCode}
                    onClick={onToggleQrCode}
                >
                    <QrCode size={14} />
                </button>

                {hasMessages && (
                    <button
                        type="button"
                        className="btn-icon"
                        title="清空传输记录"
                        aria-label="清空传输记录"
                        onClick={onClearHistory}
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {/* Clean, minimalist QR Code popover */}
            <AnimatePresence>
                {showQrCode && (
                    <motion.div
                        className="wt-qr-popover"
                        initial={{ opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -4 }}
                        transition={{ duration: 0.12 }}
                    >
                        <div className="wt-qr-popover-header">
                            <span className="wt-qr-popover-title">连接新设备</span>
                            <span className="wt-qr-popover-desc">局域网内扫码或浏览器访问</span>
                        </div>

                        <div className="wt-qr-popover-code">
                            <QRCodeCanvas value={connectionUrl} size={130} />
                        </div>

                        {interfaces.length > 1 ? (
                            <div className="wt-ip-picker">
                                <select
                                    className="wt-ip-select"
                                    value={selectedIp}
                                    onChange={(e) => onSwitchIp(e.target.value)}
                                    title="切换网卡 IP"
                                >
                                    {interfaces.map((iface) => (
                                        <option key={iface.ip} value={iface.ip}>
                                            {iface.label}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={12} className="wt-ip-select-arrow" />
                            </div>
                        ) : (
                            <div className="wt-qr-popover-address">
                                {activeIp}:{actualPort}
                            </div>
                        )}

                        <button
                            type="button"
                            className="wt-copy-link-btn"
                            onClick={() => onCopyLink(connectionUrl)}
                        >
                            <LinkIcon size={12} />
                            <span>{copiedLink ? "已复制连接地址" : "复制连接地址"}</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
