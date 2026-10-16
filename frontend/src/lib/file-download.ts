import { IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";

interface SaveTextOptions {
  content: string;
  fileName: string;
  mimeType: string;
}

/** Save text through the native picker on desktop or the browser save picker. */
export async function saveTextFile({ content, fileName, mimeType }: SaveTextOptions): Promise<boolean> {
  const bytes = new TextEncoder().encode(content);

  if (IS_DESKTOP) {
    return desktopAPI.downloadAndSave({
      data: Array.from(bytes),
      defaultName: fileName,
    });
  }

  const picker = (window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{ createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }> }>;
  }).showSaveFilePicker;

  if (picker) {
    const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
    const handle = await picker.call(window, {
      suggestedName: fileName,
      types: [{ description: mimeType, accept: { [mimeType]: extension ? [extension] : [] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return true;
  }

  // Older browsers cannot choose a path programmatically.
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
