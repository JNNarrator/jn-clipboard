// Audit-only: mirrors the browser preview of the real backend commands.
export * from '../../node_modules/@tauri-apps/api/core.js';
import { backendCommands } from './mock-backend';

const tagItems = Array.from({ length: 14 }, (_, i) => ({ id: 70000 + i, content_type: 'text', content: `带标签的记录 ${i + 1}：会议纪要与待办事项`, preview: `带标签的记录 ${i + 1}：会议纪要与待办事项`, source_app: ['浏览器', '微信', '备忘录'][i % 3], timestamp: Date.now() - i * 3600000, is_pinned: false, tags: ['工作'], use_count: i % 4 }));
export async function invoke(cmd: string, _args?: unknown): Promise<unknown> {
  // Audit/e2e-only: every call, so tests can assert what the UI asked the backend to do.
  ((globalThis as any).__invokeLog ??= []).push({ cmd, args: _args ?? null });
  if (cmd === 'get_all_tags_info') return { 工作: 14, 设计: 6, 灵感: 9, 待办: 3, 代码片段: 21, 密码: 2, 旅行: 4, 读书笔记: 11, 账单: 5, 重要: 7, 会议: 8, 链接收藏: 13 };
  if (cmd === 'get_tag_colors') return { 工作: '#4f7dff', 设计: '#ff85a1' };
  if (cmd === 'get_tag_items') return tagItems;
  if (backendCommands[cmd]) return backendCommands[cmd]((_args ?? {}) as Record<string, unknown>);
  // Setters only push state into Rust; accepting them keeps the console clean.
  if (cmd.startsWith('set_')) return null;
  throw new Error(`audit preview: ${cmd} unavailable`);
}
