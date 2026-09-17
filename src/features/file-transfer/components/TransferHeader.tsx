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
        <div className={`wt-header ${hasOnlineDevices ? "is-connected" : "is-standby"}`}>
            <div className="wt-header-left">
                <div className="wt-presence-status">
                    <span
                        className={`wt-presence-dot ${hasOnlineDevices ? "is-online" : "is-waiting"}`}
                        aria-hidden="true"
                    />
                </div>
                <div className="wt-header-title-group">
                    <div className="wt-header-title">
                        {hasOnlineDevices ? conversationTitle : "局域网投送"}
                    </div>
                    <div className="wt-header-subtitle">
                        {hasOnlineDevices
                            ? onlineDevicesCount === 1
                                ? "已就绪 · 可直接收发"
                                : `${onlineDevicesCount} 台设备在线`
                            : "等待手机扫码连接"}
                    </div>
                </div>
            </div>

            <div className="wt-header-actions">
                <button
                    type="button"
                    className={`wt-header-action ${showSearchBar || isFiltering ? "is-active" : ""}`}
                    title={showSearchBar ? "关闭搜索 (⌘F)" : "搜索与筛选 (⌘F)"}
                    aria-label="搜索与筛选"
                    onClick={onToggleSearch}
                >
                    <Search size={15} />
                </button>

                <button
                    type="button"
                    className="wt-header-action"
                    title="在访达中打开保存目录"
                    aria-label="打开保存目录"
                    onClick={onOpenFolder}
                >
                    <FolderOpen size={15} />
                </button>

                <button
                    type="button"
                    className={`wt-header-action ${showQrCode ? "is-active" : ""}`}
                    title="连接设备二维码"
                    aria-label="连接设备二维码"
                    aria-expanded={showQrCode}
                    onClick={onToggleQrCode}
                >
                    <QrCode size={15} />
                </button>

                {hasMessages && (
                    <button
                        type="button"
                        className="wt-header-action wt-header-action-danger"
                        title="清空传输记录"
                        aria-label="清空传输记录"
                        onClick={onClearHistory}
                    >
                        <Trash2 size={15} />
                    </button>
                )}
            </div>

            {/* Apple style Frosted Popover for QR / Network selection */}
            <AnimatePresence>
                {showQrCode && (
                    <motion.div
                        className="wt-qr-popover"
                        initial={{ opacity: 0, scale: 0.95, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -6 }}
                        transition={{ duration: 0.15 }}
                    >
                        <div className="wt-qr-popover-header">
                            <span className="wt-qr-popover-title">连接新设备</span>
                            <span className="wt-qr-popover-desc">用手机相机或浏览器扫码</span>
                        </div>

                        <div className="wt-qr-popover-code">
                            <QRCodeCanvas value={connectionUrl} size={132} />
                        </div>

                        {interfaces.length > 1 ? (
                            <div className="wt-ip-picker wt-ip-picker-popover">
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
                            className="wt-copy-link-action"
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
