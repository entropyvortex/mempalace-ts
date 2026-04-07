/**
 * @module utils/normalize
 * Chat format normalization — converts multiple chat export formats to plain text.
 *
 * 1:1 PORT from original normalize.py
 * Supports:
 *   - Plain text with > markers (pass through)
 *   - Claude.ai JSON export
 *   - ChatGPT conversations.json (mapping tree structure)
 *   - Claude Code JSONL
 *   - Slack JSON export
 *   - Plain text fallback
 */

interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Extract text content from a content field that may be a string, array, or object.
 * Python: normalize.py _extract_content()
 */
function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as Record<string, unknown>).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as Record<string, unknown>).text);
  }
  return '';
}

/**
 * Convert an array of messages to a transcript.
 * Python: normalize.py _messages_to_transcript()
 */
function messagesToTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    const text = msg.content.trim();
    if (!text) continue;
    if (role === 'user' || role === 'human') {
      lines.push(`> ${text}`);
    } else {
      lines.push(text);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Try to parse Claude.ai JSON format: [{"role": "user", "content": "..."}]
 * Python: normalize.py _try_claude_ai_json()
 */
function tryClaudeAiJson(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return null;

  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== 'object') return null;
  if (!('role' in first) || !('content' in first)) return null;

  const messages: ChatMessage[] = data.map((item: Record<string, unknown>) => ({
    role: String(item.role || 'user'),
    content: extractContent(item.content),
  }));

  return messagesToTranscript(messages);
}

/**
 * Try to parse ChatGPT conversations.json (mapping tree structure).
 * Python: normalize.py _try_chatgpt_json()
 */
function tryChatgptJson(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return null;

  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== 'object') return null;
  if (!('mapping' in first)) return null;

  const allMessages: ChatMessage[] = [];

  for (const conv of data as Array<Record<string, unknown>>) {
    const mapping = conv.mapping as Record<string, Record<string, unknown>> | undefined;
    if (!mapping) continue;

    // Find root: prefer node with parent=null AND no message (synthetic root)
    let rootId: string | null = null;
    let fallbackRoot: string | null = null;
    for (const [nodeId, node] of Object.entries(mapping)) {
      if (node.parent === null || node.parent === undefined) {
        if (!node.message) {
          rootId = nodeId;
          break;
        } else if (!fallbackRoot) {
          fallbackRoot = nodeId;
        }
      }
    }
    if (!rootId) rootId = fallbackRoot;

    // Traverse tree following children[0]
    if (rootId) {
      let currentId: string | null = rootId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = mapping[currentId];
        if (!node) break;

        const msg = node.message as Record<string, unknown> | undefined;
        if (msg) {
          const author = msg.author as Record<string, unknown> | undefined;
          const role = String(author?.role ?? '');
          const contentObj = msg.content as Record<string, unknown> | undefined;
          const parts = contentObj?.parts as unknown[] | undefined;
          const content = Array.isArray(parts)
            ? parts.filter((p): p is string => typeof p === 'string').join(' ').trim()
            : '';
          if ((role === 'user' || role === 'assistant') && content) {
            allMessages.push({ role, content });
          }
        }

        const children = node.children as string[] | undefined;
        currentId = children?.[0] ?? null;
      }
    }
  }

  if (allMessages.length === 0) return null;
  return messagesToTranscript(allMessages);
}

/**
 * Try to parse Slack JSON export.
 * Python: normalize.py _try_slack_json()
 */
function trySlackJson(data: unknown): string | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return null;

  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== 'object') return null;
  if (first.type !== 'message') return null;

  const lines: string[] = [];
  for (const msg of data as Array<Record<string, unknown>>) {
    const text = String(msg.text || '').trim();
    if (!text) continue;
    const user = String(msg.user || 'unknown');
    lines.push(`[${user}] ${text}`);
    lines.push('');
  }

  if (lines.length === 0) return null;
  return lines.join('\n').trim();
}

/**
 * Try to parse Claude Code JSONL format.
 * Python: normalize.py _try_claude_code_jsonl()
 */
function tryClaudeCodeJsonl(content: string): string | null {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return null;

  const messages: ChatMessage[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const type = String(obj.type || '');
      const isUser = type === 'human' || type === 'user';
      const isAssistant = type === 'assistant' || type === 'ai';
      if (!isUser && !isAssistant) continue;

      const msgObj = obj.message as Record<string, unknown> | undefined;
      if (!msgObj) continue;

      const text = extractContent(msgObj.content);
      if (text.trim()) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: text.trim(),
        });
      }
    } catch {
      // Not valid JSONL line — skip
      continue;
    }
  }

  if (messages.length === 0) return null;
  return messagesToTranscript(messages);
}

/**
 * Try to parse as JSON and normalize.
 * Python: normalize.py _try_normalize_json()
 */
function tryNormalizeJson(content: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }

  return tryClaudeAiJson(data) ?? tryChatgptJson(data) ?? trySlackJson(data) ?? null;
}

/**
 * Normalize a chat file to plain text transcript format.
 * Supports Claude.ai JSON, ChatGPT JSON, Claude Code JSONL, Slack JSON, and plain text.
 *
 * Python: normalize.py normalize()
 *
 * @param content - Raw file content
 * @returns Normalized plain text transcript
 */
export function normalize(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';

  // Already normalized (has > markers)
  if (trimmed.startsWith('>') || trimmed.includes('\n>')) {
    return trimmed;
  }

  // Try Claude Code JSONL first (line-delimited JSON)
  const jsonlResult = tryClaudeCodeJsonl(trimmed);
  if (jsonlResult) return jsonlResult;

  // Try structured JSON formats
  const jsonResult = tryNormalizeJson(trimmed);
  if (jsonResult) return jsonResult;

  // Fallback: plain text pass-through
  return trimmed;
}
