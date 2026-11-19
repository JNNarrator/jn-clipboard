// 「微信通道」设置分组。
//
// 与「跨设备同步」并列：同步解决"多台设备共用一份历史"，微信通道解决
// "手机不装 App 也能传"，二者是独立的开关，所以分成两组而不是塞进同一组。
import { ChevronDown, ChevronRight } from "lucide-react";
import WechatChannelRow from "../WechatChannelRow";

interface WechatChannelGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
}

const WechatChannelGroup = ({ t, collapsed, onToggle }: WechatChannelGroupProps) => (
    <div className={`settings-group ${collapsed ? "collapsed" : ""}`}>
        <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
            <div className="group-header-title">
                <h3>{t("wechat_channel_title")}</h3>
            </div>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        {!collapsed && (
            <div className="group-content">
                <WechatChannelRow t={t} />
            </div>
        )}
    </div>
);

export default WechatChannelGroup;
