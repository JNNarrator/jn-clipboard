import { Component, type ErrorInfo, type ReactNode } from "react";
import { formatError } from "../lib/errorMessage";

// Rendered above App, so translations are not loaded yet; the main window
// mirrors the chosen language into localStorage for exactly this purpose.
const TEXT = {
  zh: { title: "界面出现异常", body: "剪贴板记录不受影响。可以重新加载界面继续使用。", reload: "重新加载" },
  tw: { title: "介面出現異常", body: "剪貼簿紀錄不受影響。可以重新載入介面繼續使用。", reload: "重新載入" },
  en: { title: "Something went wrong", body: "Your clipboard history is safe. Reload the window to continue.", reload: "Reload" },
} as const;

const pickText = () => {
  const lang = localStorage.getItem("tiez_language");
  return lang === "en" || lang === "tw" ? TEXT[lang] : TEXT.zh;
};

interface State {
  error: unknown;
}

/** Keeps a render error in one component from blanking the whole window. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("UI crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const text = pickText();
    return (
      <div className="error-boundary" role="alert">
        <h2 className="error-boundary-title">{text.title}</h2>
        <p className="error-boundary-body">{text.body}</p>
        <p className="error-boundary-detail">{formatError(this.state.error, undefined, 160)}</p>
        <button type="button" className="modal-button primary" onClick={() => window.location.reload()}>
          {text.reload}
        </button>
      </div>
    );
  }
}
