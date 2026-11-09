// The cross-device sync group for the desktop build: the JNClub row is the
// whole surface. There is deliberately no switch and no server field — the
// JnclubSyncRow component owns everything (state line, sign in / out, and the
// expired-session recovery).
import { ChevronDown, ChevronRight } from "lucide-react";
import JnclubSyncRow from "../JnclubSyncRow";

interface JnclubSyncGroupProps {
    t: (key: string) => string;
    collapsed: boolean;
    onToggle: () => void;
}

const JnclubSyncGroup = ({ t, collapsed, onToggle }: JnclubSyncGroupProps) => (
    <div className={`settings-group ${collapsed ? "collapsed" : ""}`}>
        <button type="button" className="group-header" aria-expanded={!collapsed} onClick={onToggle}>
            <div className="group-header-title">
                <h3>{t("jnclub_sync_title")}</h3>
            </div>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        {!collapsed && (
            <div className="group-content">
                <JnclubSyncRow t={t} />
            </div>
        )}
    </div>
);

export default JnclubSyncGroup;
