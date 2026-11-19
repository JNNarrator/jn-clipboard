// 设置页的「微信通道」一行：状态、二维码、启停。
//
// 设计取舍与 JnclubSyncRow 保持一致——这一组里只放用户真正要做的决定，
// 不放服务器地址、token 这类不该由用户关心的东西（它们来自已有的 JNClub 登录）。
//
// 二维码用后端给的字符串在前端渲染成图，而不是让后端直接回 PNG：
// 这样图片大小、留白、深浅色适配都留在前端，后端不必关心 UI。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SyncStatus {
    state: string;
    connected: boolean;
    user_id?: string | null;
    error?: string | null;
    waiting_scan: boolean;
    notify_on_copy: boolean;
    whitelist?: string | null;
}

interface QrcodeResult {
    connected: boolean;
    qrcodeContent?: string | null;
    /** 后端直接渲染好的 `data:image/png;base64,...`，前端无需二维码库。 */
    qrcodeImage?: string | null;
    message?: string | null;
}

interface WechatChannelRowProps {
    t: (key: string) => string;
}

const STATE_LABEL: Record<string, string> = {
    CONNECTED: "wechat_state_connected",
    WAITING_SCAN: "wechat_state_waiting",
    DOWN: "wechat_state_down",
};

const WechatChannelRow = ({ t }: WechatChannelRowProps) => {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [qrcode, setQrcode] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        try {
            setStatus(await invoke<SyncStatus>("get_wechat_status"));
            setError(null);
        } catch (err) {
            // 未配置同步或未登录都会走到这里；这不是故障，只是还没准备好。
            setError(String(err));
        }
    };

    useEffect(() => {
        void refresh();
        // 扫码是异步完成的（后端在等用户扫），所以轮询状态；
        // 已连接时降频，避免无谓请求。
        const timer = window.setInterval(() => {
            void refresh();
        }, status?.connected ? 30_000 : 3_000);
        return () => window.clearInterval(timer);
    }, [status?.connected]);

    const startLogin = async () => {
        setBusy(true);
        setError(null);
        try {
            const result = await invoke<QrcodeResult>("request_wechat_qrcode");
            if (result.connected) {
                setQrcode(null);
                await refresh();
            } else {
                setQrcode(result.qrcodeImage ?? null);
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const stop = async () => {
        setBusy(true);
        try {
            await invoke("stop_wechat_channel");
            setQrcode(null);
            await refresh();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const resume = async () => {
        setBusy(true);
        try {
            await invoke("resume_wechat_channel");
            await refresh();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const state = status?.state ?? "DOWN";
    const stateKey = STATE_LABEL[state] ?? "wechat_state_down";

    return (
        <div className="setting-item">
            <div className="item-label-group">
                <span className="item-label">{t("wechat_channel_label")}</span>
                <span className="settings-panel-meta">
                    {status?.connected ? t("wechat_hint_connected") : t("wechat_hint_disconnected")}
                </span>
            </div>

            <div className="wechat-channel-actions">
                <span className="settings-panel-meta">{t(stateKey)}</span>
                {status?.connected ? (
                    <button
                        type="button"
                        className="settings-action-button settings-action-button--small"
                        disabled={busy}
                        onClick={stop}
                    >
                        {t("wechat_action_stop")}
                    </button>
                ) : (
                    <>
                        <button
                            type="button"
                            className="settings-action-button settings-action-button--small"
                            disabled={busy}
                            onClick={resume}
                        >
                            {t("wechat_action_resume")}
                        </button>
                        <button
                            type="button"
                            className="settings-action-button settings-action-button--small"
                            disabled={busy}
                            onClick={startLogin}
                        >
                            {t("wechat_action_login")}
                        </button>
                    </>
                )}
            </div>

            {error && (
                <div className="setting-item is-child">
                    <div className="settings-panel-meta is-error">{error}</div>
                </div>
            )}

            {qrcode && !status?.connected && (
                <div className="setting-item is-child wechat-qrcode">
                    <img src={qrcode} alt={t("wechat_scan_hint")} width={220} height={220} />
                    <span className="settings-panel-meta">{t("wechat_scan_hint")}</span>
                </div>
            )}
        </div>
    );
};

export default WechatChannelRow;
