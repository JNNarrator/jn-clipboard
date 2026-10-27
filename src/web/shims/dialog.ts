/**
 * Browser stand-in for `@tauri-apps/plugin-dialog`.
 *
 * The desktop dialogs return *paths*; a browser has no filesystem paths, so
 * `open` resolves `null` (the same "user cancelled" answer the UI already
 * handles) and `save` uses the File System Access API where it exists. `ask` and
 * `message` map onto the native browser prompts, which is what the desktop
 * versions are anyway.
 */
export type OpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
  title?: string;
};

export type SaveDialogOptions = {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
};

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

/**
 * No uploadable path exists in a browser, so file-import flows resolve the
 * cancelled answer. Callers already handle `null`.
 */
export async function open(_options?: OpenDialogOptions): Promise<null> {
  console.warn("[web] native file dialogs are unavailable; returning no selection");
  return null;
}

export async function save(options?: SaveDialogOptions): Promise<string | null> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (!picker) return null;
  try {
    const handle = await picker({
      suggestedName: options?.defaultPath,
      types: options?.filters?.map((filter) => ({
        description: filter.name,
        accept: { "application/octet-stream": filter.extensions.map((ext) => `.${ext}`) },
      })),
    });
    return handle.name;
  } catch {
    return null;
  }
}

export async function message(text: string, options?: { title?: string }): Promise<void> {
  window.alert(options?.title ? `${options.title}\n\n${text}` : text);
}

export async function ask(text: string, options?: { title?: string }): Promise<boolean> {
  return window.confirm(options?.title ? `${options.title}\n\n${text}` : text);
}

export async function confirm(text: string, options?: { title?: string }): Promise<boolean> {
  return ask(text, options);
}
