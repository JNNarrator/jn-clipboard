import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { withNativeDialog } from "../../../shared/lib/focus";

export default function SecureTransfer() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const run = async (importing: boolean) => {
    setStatus("");
    if (new TextEncoder().encode(password).length < 12) { setStatus("迁移密码至少需要 12 字节，请使用较长的密码。"); return; }
    if (!importing && password !== confirmation) { setStatus("两次密码不一致。"); return; }
    if (importing && !acknowledged) { setStatus("请先确认目标设备的存储方式。"); return; }
    setBusy(true);
    try {
      const filters = [{ name: "TieZ 加密迁移包", extensions: ["tiezx"] }];
      const path = await withNativeDialog(() => importing ? open({ filters, multiple: false }) : save({ filters, defaultPath: "TieZ.tiezx" }), "settings:secure-transfer");
      if (!path || typeof path !== "string") return;
      const result = await invoke<{ transferred: number; excluded: number }>(importing ? "import_secure_transfer" : "export_secure_transfer", { path, password, acknowledgePlaintext: acknowledged });
      setStatus(`${importing ? "导入" : "导出"}成功：${result.transferred} 条，未包含 ${result.excluded} 条非文本记录。${importing ? "重新打开客户端以刷新列表。" : "请妥善保管密码，遗失后无法恢复迁移包。"}`);
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); setPassword(""); setConfirmation(""); }
  };
  return <details className="settings-group" style={{ padding: 16 }}>
    <summary>密码保护的文本迁移</summary>
    <p>用于跨设备或安装版／便携版之间迁移文字记录。包含文本、代码、链接和富文本；不包含设置、图片、文件及富文本引用的本地附件。原设备数据保留。</p>
    <label>迁移密码<input type="password" autoComplete="off" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
    <label>导出时再次确认密码<input type="password" autoComplete="off" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
    <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />我已了解：便携版导入后以明文保存；安装版仅对标记为敏感的记录加密。</label>
    <div><button type="button" disabled={busy} onClick={() => void run(false)}>导出加密包</button> <button type="button" disabled={busy} onClick={() => void run(true)}>导入加密包</button></div>
    <p role="status">{busy ? "正在处理，请稍候……" : status}</p>
  </details>;
}
