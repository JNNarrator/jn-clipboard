import { useState, useRef, useEffect } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
    FolderOpen,
    Trash2,
    QrCode,
    Search,
    Link as LinkIcon,
    MoreHorizontal,
    Globe,
    Check,
} from "lucide-react";
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
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        if (!showMoreMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (!moreMenuRef.current?.contains(e.target as Node)) {
                setShowMoreMenu(false);
            }
        };
        window.addEventListener("pointerdown", handleClickOutside);
        return () => window.removeEventListener("pointerdown", handleClickOutside);
    }, [showMoreMenu]);

    return (
        <div className="wt-header">
            {/* Left: Clear connection status indicator */}
            <div className="wt-header-status-group">
                <span
                    className={`wt-status-dot ${hasOnlineDevices ? "is-online" : "is-waiting"}`}
                    aria-hidden="true"
                />
                <div className="wt-header-status-copy">
                    <span className="wt-status-primary">
                        {hasOnlineDevices
                            ? (conversationTitle || "设备已就绪")
                            : "等待设备连接"}
                    </span>
                    <span className="wt-status-secondary">
                        {hasOnlineDevices
                            ? (onlineDevicesCount === 1 ? "局域网高速传输中" : `${onlineDevicesCount} 台设备在线`)
                            : `${activeIp}:${actualPort}`}
                    </span>
                </div>
            </div>

            {/* Right: Only primary Search button + "三个点" (...) More Menu button */}
            <div className="wt-header-actions" ref={moreMenuRef}>
                <button
                    type="button"
                    className={`wt-header-action ${showSearchBar || isFiltering ? "is-active" : ""}`}
                    title={showSearchBar ? "关闭搜索与筛选" : "搜索与筛选记录 (⌘F)"}
                    aria-label="搜索与筛选记录"
                    onClick={onToggleSearch}
                >
                    <Search size={15} />
                </button>

                <button
                    type="button"
                    className={`wt-header-action ${showMoreMenu ? "is-active" : ""}`}
                    title="更多操作"
                    aria-label="更多操作"
                    aria-expanded={showMoreMenu}
                    onClick={() => setShowMoreMenu((prev) => !prev)}
                >
                    <MoreHorizontal size={16} />
                </button>

                {/* "三个点" 更多操作下拉菜单 */}
                {showMoreMenu && (
                    <div className="wt-more-menu" role="menu">
                        <button
                            type="button"
                            className="wt-more-menu-item"
                            role="menuitem"
                            onClick={() => {
                                setShowMoreMenu(false);
                                onOpenFolder();
                            }}
                        >
                            <FolderOpen size={14} />
                            <span>在访达中打开保存目录</span>
                        </button>

                        <button
                            type="button"
                            className="wt-more-menu-item"
                            role="menuitem"
                            onClick={() => {
                                setShowMoreMenu(false);
                                onToggleQrCode();
                            }}
                        >
                            <QrCode size={14} />
                            <span>查看连接二维码</span>
                        </button>

                        <button
                            type="button"
                            className="wt-more-menu-item"
                            role="menuitem"
                            onClick={() => {
                                onCopyLink(connectionUrl);
                            }}
                        >
                            <LinkIcon size={14} />
                            <span>{copiedLink ? "已复制连接地址" : "复制连接地址"}</span>
                        </button>

                        {interfaces.length > 1 && (
                            <>
                                <div className="wt-more-menu-divider" role="separator" />
                                <div className="wt-more-menu-section-label">切换网络地址</div>
                                {interfaces.map((iface) => (
                                    <button
                                        key={iface.ip}
                                        type="button"
                                        className={`wt-more-menu-item ${selectedIp === iface.ip ? "is-selected" : ""}`}
                                        role="menuitemradio"
                                        aria-checked={selectedIp === iface.ip}
                                        onClick={() => {
                                            onSwitchIp(iface.ip);
                                        }}
                                    >
                                        <Globe size={14} />
                                        <span className="wt-more-menu-ip-label">{iface.label}</span>
                                        {selectedIp === iface.ip && <Check size={12} className="wt-more-menu-check" />}
                                    </button>
                                ))}
                            </>
                        )}

                        {hasMessages && (
                            <>
                                <div className="wt-more-menu-divider" role="separator" />
                                <button
                                    type="button"
                                    className="wt-more-menu-item is-danger"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowMoreMenu(false);
                                        onClearHistory();
                                    }}
                                >
                                    <Trash2 size={14} />
                                    <span>清空传输记录</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* QR Code Popover */}
            {showQrCode && (
                <div className="wt-qr-popover">
                    <div className="wt-qr-popover-code">
                        <QRCodeCanvas value={connectionUrl} size={130} />
                    </div>
                    <div className="wt-qr-popover-title">手机扫码连接</div>
                    <div className="wt-qr-popover-address">{activeIp}:{actualPort}</div>
                    <button
                        type="button"
                        className="wt-copy-link-action"
                        onClick={() => onCopyLink(connectionUrl)}
                    >
                        <LinkIcon size={12} />
                        <span>{copiedLink ? "已复制地址" : "复制连接地址"}</span>
                    </button>
                </div>
            )}
        </div>
    );
};
