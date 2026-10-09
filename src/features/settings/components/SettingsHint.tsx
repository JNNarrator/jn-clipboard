import { createContext, memo, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

interface SettingsHintState {
    openHints: Set<string>;
    toggleHint: (key: string) => void;
}

const SettingsHintContext = createContext<SettingsHintState | null>(null);

export const SettingsHintProvider = ({ children }: { children: ReactNode }) => {
    const [openHints, setOpenHints] = useState<Set<string>>(new Set());
    const toggleHint = useCallback((key: string) => {
        setOpenHints(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);
    const value = useMemo(() => ({ openHints, toggleHint }), [openHints, toggleHint]);

    return <SettingsHintContext.Provider value={value}>{children}</SettingsHintContext.Provider>;
};

// Keep this component type stable during live slider updates. Remounting labels
// briefly shrinks the scroll pane, making WebKit clamp its scroll position.
export const LabelWithHint = memo(({ label, hint, hintKey }: {
    label: string;
    hint?: string | ReactNode;
    hintKey: string;
}) => {
    const state = useContext(SettingsHintContext);
    const [summary, ...rest] = typeof hint === "string" ? hint.split("\n") : [];
    const details = typeof hint === "string" ? (rest.length ? rest.join("\n") : undefined) : hint;
    const open = state?.openHints.has(hintKey);

    return (
        <div className="item-label-group">
            <div className="item-label-row">
                <span className="item-label">{label}</span>
                {details && (
                    <button
                        type="button"
                        className="hint-icon-btn"
                        aria-expanded={open}
                        aria-label={label}
                        title={typeof details === "string" ? details : undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            state?.toggleHint(hintKey);
                        }}
                    >
                        <HelpCircle size={13} />
                    </button>
                )}
            </div>
            {summary && <span className="item-desc">{summary}</span>}
            {details && open && (
                typeof details === "string" ? <span className="hint">{details}</span> : details
            )}
        </div>
    );
});
