import { QRCodeCanvas } from "qrcode.react";
import {
    ChevronDown,
    FolderOpen,
    Trash2,
    QrCode,
    Search,
    Link as LinkIcon,
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
    return (
        <div className={`wt-header ${hasOnlineDevices ? 'is-connected' : 'is-onboarding'}`}>
            {!hasOnlineDevices ? (
                <div className="wt-onboarding-connect">
                    <div className="wt-onboarding-identity">
                        <div className="wt-onboarding-copy">
                            <div className="wt-onboarding-title">局域网文件传输</div>
                            <div className="wt-onboarding-status">等待设备连接</div>
                            {interfaces.length > 1 ? (
                                <div className="wt-onboarding-address-row">
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
                                    <button
                                        type="button"
                                        className="wt-copy-link-btn"
                                        title={copiedLink ? '已复制链接' : '复制连接地址'}
                                        aria-label="复制连接地址"
                                        onClick={() => onCopyLink(connectionUrl)}
                                    >
                                        <LinkIcon size={12} />
                                    </button>
                                </div>
                            ) : (
                                <div className="wt-onboarding-address-row">
                                    <div className="wt-onboarding-address">{activeIp}:{actualPort}</div>
                                    <button
                                        type="button"
                                        className="wt-copy-link-btn"
                                        title={copiedLink ? '已复制链接' : '复制连接地址'}
                                        aria-label="复制连接地址"
                                        onClick={() => onCopyLink(connectionUrl)}
                                    >
                                        <LinkIcon size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="wt-header-actions">
                        <button
                            type="button"
                            className={`wt-header-action ${showSearchBar || isFiltering ? 'is-active' : ''}`}
                            title={showSearchBar ? '关闭搜索与筛选' : '搜索与筛选记录 (⌘F)'}
                            aria-label="搜索与筛选记录"
                            onClick={onToggleSearch}
                        >
                            <Search size={18} />
                        </button>
                        <button
                            type="button"
                            className="wt-header-action"
                            title="打开保存目录"
                            aria-label="打开保存目录"
                            onClick={onOpenFolder}
                        >
                            <FolderOpen size={18} />
                        </button>
                        {hasMessages && (
                            <button
                                type="button"
                                className="wt-header-action"
                                title="清空传输记录"
                                aria-label="清空传输记录"
                                onClick={onClearHistory}
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                    <div className="wt-onboarding-qr" title="手机扫码连接">
                        <QRCodeCanvas value={connectionUrl} size={54} />
                    </div>
                </div>
            ) : (
                <>
                    <div className="wt-conversation-identity">
                        <div className="wt-conversation-copy">
                            <div className="wt-conversation-title">{conversationTitle}</div>
                            <div className="wt-presence-line">
                                {onlineDevicesCount === 1 ? '在线 · 局域网传输' : `${onlineDevicesCount} 台设备在线`}
                            </div>
                        </div>
                    </div>
                    <div className="wt-header-actions">
                        <button
                            type="button"
                            className={`wt-header-action ${showSearchBar || isFiltering ? 'is-active' : ''}`}
                            title={showSearchBar ? '关闭搜索与筛选' : '搜索与筛选记录 (⌘F)'}
                            aria-label="搜索与筛选记录"
                            onClick={onToggleSearch}
                        >
                            <Search size={18} />
                        </button>
                        <button
                            type="button"
                            className="wt-header-action"
                            title="打开保存目录"
                            aria-label="打开保存目录"
                            onClick={onOpenFolder}
                        >
                            <FolderOpen size={18} />
                        </button>
                        {hasMessages && (
                            <button
                                type="button"
                                className="wt-header-action"
                                title="清空传输记录"
                                aria-label="清空传输记录"
                                onClick={onClearHistory}
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                        <button
                            type="button"
                            className={`wt-header-action ${showQrCode ? 'is-active' : ''}`}
                            title="显示连接二维码"
                            aria-label="显示连接二维码"
                            aria-expanded={showQrCode}
                            onClick={onToggleQrCode}
                        >
                            <QrCode size={19} />
                        </button>
                    </div>
                    {showQrCode && (
                        <div className="wt-qr-popover">
                            <div className="wt-qr-popover-code">
                                <QRCodeCanvas value={connectionUrl} size={112} />
                            </div>
                            <div className="wt-qr-popover-title">连接其他设备</div>
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
                                <div className="wt-qr-popover-address">{activeIp}:{actualPort}</div>
                            )}
                            <button
                                type="button"
                                className="wt-copy-link-action"
                                onClick={() => onCopyLink(connectionUrl)}
                            >
                                <LinkIcon size={12} />
                                <span>{copiedLink ? '已复制链接' : '复制连接地址'}</span>
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
