export const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false;

  return (
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    /Mac/i.test(navigator.platform)
  );
};

export const isWindowsPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false;

  return (
    /Windows|Win32|Win64/i.test(navigator.userAgent) ||
    /Win/i.test(navigator.platform)
  );
};

export const getNotePlaceholder = (t: (key: string) => string): string => {
  return isMacPlatform()
    ? (t("note_placeholder_mac") || "添加备注…（⌘+Enter 保存，Esc 取消）")
    : (t("note_placeholder_win") || "添加备注…（Ctrl+Enter 保存，Esc 取消）");
};
