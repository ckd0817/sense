import { DeviceEventEmitter } from 'react-native';
import { getAISettings, getGranularity, getCustomCategories, addCustomCategory, getAllTodos, addTodo, updateTodo, completeTodo, uncompleteTodo, findTodoByTitle, insertActivity, getTodayRecords, getRecordsByDate, updateRecord, deleteRecord, getSystemPrompt, Record as ActivityRecord } from './db';
import { scheduleTodoReminder, cancelTodoReminder } from './notifications';
import { CategoryIcons } from '../constants/theme';
import { toLocalISO } from './time';

export const DATA_CHANGED_EVENT = 'sense-data-changed';

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Tool Definitions (OpenAI function calling format) ---

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'create_activity',
      description: '记录一个活动（已发生或正在进行的事情）',
      parameters: {
        type: 'object',
        properties: {
          activity: { type: 'string', description: '活动名称（简短，如"午餐"、"上课"）' },
          category: { type: 'string', description: '活动分类' },
          start_time: { type: 'string', description: '开始时间，格式如 2026-04-25T17:30:00，不要带时区和Z' },
          end_time: { type: 'string', description: '结束时间，格式如 2026-04-25T18:00:00，不要带时区和Z，可为空' },
          details: { type: 'string', description: '活动细节' },
          mood: { type: 'string', description: '情绪感受' },
          social: { type: 'string', description: '和谁在一起' },
          location: { type: 'string', description: '在哪里' },
        },
        required: ['activity', 'start_time'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_todo',
      description: '创建一个待办事项。可以是每日重复的习惯，也可以是一次性的临时待办。如果有计划时间，可以指定 scheduled_time。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题' },
          recurring: { type: 'boolean', description: '是否每日重复（习惯），默认 false' },
          scheduled_time: { type: 'string', description: '计划时间，格式如 2026-04-25T17:30:00，不要带时区和Z，可选' },
          reminder_advance: { type: 'number', description: '提前多少分钟提醒，可选。默认 10 分钟' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_todo',
      description: '修改已有的待办事项。按标题模糊匹配，更新指定字段。可完成/取消完成待办。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题（模糊匹配）' },
          completed: { type: 'boolean', description: '是否标记为已完成' },
          new_title: { type: 'string', description: '修改后的新标题，可选' },
          scheduled_time: { type: 'string', description: '新的计划时间，格式如 2026-04-25T17:30:00，不要带时区和Z，可选' },
          reminder_advance: { type: 'number', description: '新的提前提醒分钟数，可选' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_todo',
      description: '删除一个待办事项。按标题模糊匹配。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题（模糊匹配）' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_activity',
      description: '修改已有的活动记录。按活动名称模糊匹配今天最近的记录，更新指定字段。用于补充信息、修正错误或合并连续同类活动。',
      parameters: {
        type: 'object',
        properties: {
          activity: { type: 'string', description: '活动名称（模糊匹配）' },
          match_start_time: { type: 'string', description: '用于定位原记录的原开始时间，格式如 2026-04-25T17:30:00，不要带时区和Z，可选' },
          start_time: { type: 'string', description: '新的开始时间，格式如 2026-04-25T17:30:00，不要带时区和Z，可选' },
          end_time: { type: 'string', description: '新的结束时间，格式如 2026-04-25T18:00:00，不要带时区和Z' },
          category: { type: 'string', description: '新的分类' },
          details: { type: 'string', description: '新的活动细节' },
          mood: { type: 'string', description: '新的情绪感受' },
          social: { type: 'string', description: '新的社交信息' },
          location: { type: 'string', description: '新的地点' },
        },
        required: ['activity'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_activity',
      description: '删除一条活动记录。按活动名称模糊匹配今天最近的记录。',
      parameters: {
        type: 'object',
        properties: {
          activity: { type: 'string', description: '活动名称（模糊匹配）' },
          start_time: { type: 'string', description: '限定匹配的开始时间范围，不要带时区和Z，可选' },
        },
        required: ['activity'],
      },
    },
  },
];

// --- Types ---

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type RequestMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export interface AgentRequestContext {
  model: string;
  temperature: number;
  stream: boolean;
  messages: RequestMessage[];
  tools: typeof tools;
}

export interface ActionLog {
  tool: string;
  args: Record<string, unknown>;
  result: { success: boolean; message?: string; id?: string };
}

export interface AgentResult {
  summary: string;
  actions: ActionLog[];
}

// --- System Prompt ---

export const DEFAULT_SYSTEM_PROMPT = `你是一个日程管理和记录助手。用户用自然语言描述他们的活动、计划和习惯，你通过调用工具来帮助他们管理。

当前时间：{{current_time}}
时间粒度：{{granularity}}分钟。所有时间的分钟部分四舍五入到最近的粒度边界。
可用分类：{{categories}}

## 当前待办列表
{{todo_list}}

## 今天活动列表
{{activity_list}}

## 工具使用规则

### 核心判断：活动 vs 待办
根据描述的时间与当前时间的关系判断：
- **时间在当前之前或正在发生** → 活动（create_activity）：过去的事
- **时间在当前之后** → 待办（create_todo）：未来的计划
- 没有明确时间的习惯性描述（"我要每天X"）→ 待办（create_todo, recurring=true）

### 记录活动
用户描述已经发生或正在进行的事情 → 调用 create_activity。
如果该活动恰好匹配某个未完成的待办 → 同时调用 update_todo(title="...", completed=true)。
用户继续做同一件事（连续同类活动）→ 调用 update_activity 合并，延长 end_time。
用户补充或修正已有活动信息 → 调用 update_activity。
如果用户描述的是对今天已有活动、预测活动或同一时间段活动的修正 → 优先调用 update_activity，不要新建重复活动。

### 修改/删除活动
- "刚才的课延长到5点" → update_activity(activity="上课", end_time="...")
- "把通勤改成9:30到10点" → update_activity(activity="通勤", start_time="...", end_time="...")
- "中午吃的是火锅" → update_activity(activity="午餐", details="火锅")
- "3-4点的课删了" → delete_activity(activity="上课")

### 创建待办
用户描述未来的计划 → 调用 create_todo。
- "我要养成每天X的习惯" → create_todo(title="X", recurring=true)
- "X点要去做Y" → create_todo(title="Y", scheduled_time="...")
- "记得做X" → create_todo(title="X")
- "X点做Y" → create_todo(title="Y", scheduled_time="...", reminder_advance=10)
- "X点做Y，提前N分钟提醒" → create_todo(title="Y", scheduled_time="...", reminder_advance=N)
- 有 scheduled_time 时默认 reminder_advance=10，用户指定了其他值则用用户的值

### 完成待办
用户说某事做完了，且该事在待办列表中 → 调用 update_todo(title="...", completed=true)。

### 删除待办
用户要求删除某个待办 → 调用 delete_todo。

### 注意
- 一条消息可能需要调用多个工具
- 时间推算：根据当前时间和用户的相对描述推算具体时间
- 只提取用户明确提到的信息，不要编造，如果有不清楚的地方可以询问用户
- 对于 create_activity 的 category，优先从可用分类中选择
- 如果没有合适的分类，可以自创分类名（简洁两字词），新分类会自动保存供后续复用
- update_activity 的 start_time 表示要保存的新开始时间；如果只是为了定位原记录，使用 match_start_time
- 同一个时间段只能有一个活动；如果新活动时间段和已有活动重叠，后来的真实活动会覆盖前面的活动
- create_todo 如果用户指定了 scheduled_time 但没有指定提前提醒时间，默认设置 reminder_advance=10（分钟）`;

const RUNTIME_SYSTEM_GUARDRAILS = `## 运行约束
- 用户请求可以直接落库或修改时，优先调用工具，不要先输出长篇解释。
- 思考保持简短，不要反复讨论同一个时间边界；做出最合理的半小时归并后继续执行。
- 所有活动、待办时间会被四舍五入到最近的半小时边界（:00–:14→:00，:15–:44→:30，:45–:59→下一个整点）。
- 如果归并后会导致活动重叠或 0 时长，调整 end_time 让时间线保持连续、非重叠。
- 一条消息包含多段活动时，尽量在同一轮一次性调用所有需要的工具，然后再用一句话总结处理结果。`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function shouldIncludeTodoInPrompt(todo: { recurring: number; last_completed: string | null }, promptDate: string): boolean {
  if (todo.recurring) return todo.last_completed !== promptDate;
  return !todo.last_completed;
}

function buildSystemPrompt(todos: { title: string; recurring: number; last_completed: string | null; scheduled_time: string | null }[], granularity: number, categories: string[], activities: ActivityRecord[], template: string, nowOverride?: Date): string {
  const now = nowOverride || new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const activeTodos = todos.filter(t => shouldIncludeTodoInPrompt(t, today));

  const todoList = activeTodos.length > 0
    ? activeTodos.map(t => {
        const type = t.recurring ? '每日习惯' : '临时待办';
        const time = t.scheduled_time ? `，计划时间: ${t.scheduled_time}` : '';
        return `- ${t.title}（${type}${time}）○ 未完成`;
      }).join('\n')
    : '（无待办）';

  const activityList = activities.length > 0
    ? activities.map(r => {
        const time = `${formatTime(r.start_time)}-${r.end_time ? formatTime(r.end_time) : '现在'}`;
        const parts = [`- ${r.activity}（${time}）`];
        if (r.category && r.category !== '其他') parts[0] += ` [${r.category}]`;
        if (r.details) parts.push(`  详情: ${r.details}`);
        if (r.mood) parts.push(`  心情: ${r.mood}`);
        if (r.social) parts.push(`  社交: ${r.social}`);
        if (r.location) parts.push(`  地点: ${r.location}`);
        return parts.join('\n');
      }).join('\n')
    : '（无活动）';

  const rendered = template
    .replace('{{current_time}}', toLocalISO(now))
    .replace('{{granularity}}', String(granularity))
    .replace('{{categories}}', categories.join('、'))
    .replace('{{todo_list}}', todoList)
    .replace('{{activity_list}}', activityList);

  return `${rendered}\n\n${RUNTIME_SYSTEM_GUARDRAILS}`;
}

// --- Activity matching helper ---

async function findTodayActivity(name: string, timeHint?: string): Promise<{ id: string; activity: string } | null> {
  const records = await getTodayRecords();
  const lower = name.toLowerCase();
  const candidates = timeHint
    ? records.filter(r => r.start_time.startsWith(timeHint.slice(0, 10)))
    : records;
  const nameMatches = candidates.filter(r => r.activity.toLowerCase() === lower);
  const fuzzyMatches = candidates.filter(r => r.activity.toLowerCase().includes(lower) || lower.includes(r.activity.toLowerCase()));
  const matches = nameMatches.length > 0 ? nameMatches : fuzzyMatches;
  if (matches.length === 0) return null;

  const hintTime = timeHint ? new Date(timeHint).getTime() : NaN;
  const match = Number.isNaN(hintTime)
    ? matches[0]
    : matches
        .map(r => {
          const start = new Date(r.start_time).getTime();
          const end = r.end_time ? new Date(r.end_time).getTime() : start;
          const overlaps = start <= hintTime && hintTime <= end;
          return { record: r, distance: overlaps ? 0 : Math.abs(start - hintTime) };
        })
        .sort((a, b) => a.distance - b.distance)[0].record;
  return match ? { id: match.id, activity: match.activity } : null;
}

// --- Tool Executor ---

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ success: boolean; message?: string; id?: string }> {
  try {
    switch (name) {
      case 'create_activity': {
        const now = toLocalISO(new Date());
        const id = await insertActivity({
          created_at: now,
          start_time: args.start_time as string,
          end_time: (args.end_time as string) || null,
          raw_text: '',
          activity: args.activity as string,
          category: (args.category as string) || '其他',
          details: (args.details as string) || '',
          mood: (args.mood as string) || '',
          social: (args.social as string) || '',
          location: (args.location as string) || '',
        });
        // Save new category if needed
        if (args.category) {
          const defaultCategories = Object.keys(CategoryIcons);
          const custom = await getCustomCategories();
          const all = [...defaultCategories, ...custom];
          if (!all.includes(args.category as string)) {
            await addCustomCategory(args.category as string);
          }
        }
        return { success: true, id };
      }
      case 'create_todo': {
        const advance = (args.reminder_advance as number) ?? 10;
        const id = await addTodo(
          args.title as string,
          (args.recurring as boolean) || false,
          (args.scheduled_time as string) || undefined,
          args.scheduled_time ? advance : undefined,
        );
        if (args.scheduled_time) {
          await scheduleTodoReminder(id, args.title as string, args.scheduled_time as string, advance);
        }
        return { success: true, id };
      }
      case 'update_todo': {
        const todo = await findTodoByTitle(args.title as string);
        if (!todo) return { success: false, message: `未找到待办「${args.title as string}」` };
        const today = todayDateStr();
        if (args.completed === true) {
          if (todo.last_completed !== today) {
            await completeTodo(todo.id);
            await cancelTodoReminder(todo.id);
          }
          return { success: true };
        }
        if (args.completed === false) {
          await uncompleteTodo(todo.id);
          // 重新调度通知（若有计划时间）
          if (todo.scheduled_time) {
            await scheduleTodoReminder(todo.id, todo.title, todo.scheduled_time, todo.reminder_advance ?? 10);
          }
          return { success: true };
        }
        const updates: Parameters<typeof updateTodo>[1] = {};
        if (args.new_title !== undefined) updates.title = args.new_title as string;
        if (args.scheduled_time !== undefined) updates.scheduled_time = args.scheduled_time as string;
        if (args.reminder_advance !== undefined) updates.reminder_advance = args.reminder_advance as number;
        if (Object.keys(updates).length === 0) return { success: true, message: '没有需要更新的字段' };
        await updateTodo(todo.id, updates);
        await cancelTodoReminder(todo.id);
        if (updates.scheduled_time) {
          const advance = updates.reminder_advance ?? todo.reminder_advance ?? 10;
          await scheduleTodoReminder(todo.id, updates.title ?? todo.title, updates.scheduled_time, advance);
        }
        return { success: true, id: todo.id };
      }
      case 'delete_todo': {
        const todo = await findTodoByTitle(args.title as string);
        if (!todo) return { success: false, message: `未找到待办「${args.title as string}」` };
        const { deleteTodo } = await import('./db');
        await deleteTodo(todo.id);
        await cancelTodoReminder(todo.id);
        return { success: true, id: todo.id };
      }
      case 'update_activity': {
        const found = await findTodayActivity(
          args.activity as string,
          (args.match_start_time as string | undefined) || (args.start_time as string | undefined),
        );
        if (!found) return { success: false, message: `未找到活动「${args.activity as string}」` };
        const updates: { [k: string]: unknown } = {};
        for (const key of ['start_time', 'end_time', 'category', 'details', 'mood', 'social', 'location'] as const) {
          if (args[key] !== undefined) updates[key] = args[key];
        }
        if (Object.keys(updates).length === 0) return { success: true, message: '没有需要更新的字段' };
        await updateRecord(found.id, updates);
        // Save new category if needed
        if (updates.category) {
          const defaultCategories = Object.keys(CategoryIcons);
          const custom = await getCustomCategories();
          const all = [...defaultCategories, ...custom];
          if (!all.includes(updates.category as string)) {
            await addCustomCategory(updates.category as string);
          }
        }
        return { success: true, id: found.id };
      }
      case 'delete_activity': {
        const found = await findTodayActivity(args.activity as string, args.start_time as string | undefined);
        if (!found) return { success: false, message: `未找到活动「${args.activity as string}」` };
        await deleteRecord(found.id);
        return { success: true, id: found.id };
      }
      default:
        return { success: false, message: `未知工具: ${name}` };
    }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '执行失败' };
  }
}

async function executeToolAndNotify(name: string, args: Record<string, unknown>): Promise<{ success: boolean; message?: string; id?: string }> {
  const result = await executeTool(name, args);
  if (result.success) {
    DeviceEventEmitter.emit(DATA_CHANGED_EVENT, { tool: name });
  }
  return result;
}

// --- Stream Types ---

export type StreamEvent =
  | { type: 'request_context'; context: AgentRequestContext }
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'status'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: { success: boolean; message?: string } }
  | { type: 'done' };

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// --- Build context ---

async function buildContext(targetDate?: string): Promise<{ systemPrompt: string; url: string; apiKey: string; model: string }> {
  const settings = await getAISettings();
  if (!settings.apiUrl || !settings.apiKey) throw new Error('请先在设置中配置 AI API');

  const granularity = await getGranularity();
  const defaultCategories = Object.keys(CategoryIcons);
  const customCategories = await getCustomCategories();
  const categories = [...defaultCategories, ...customCategories.filter(c => !defaultCategories.includes(c))];
  const todos = await getAllTodos();
  const activities = targetDate ? await getRecordsByDate(targetDate) : await getTodayRecords();
  const customPrompt = await getSystemPrompt();

  let nowOverride: Date | undefined;
  if (targetDate) {
    const actual = new Date();
    const [y, m, d] = targetDate.split('-').map(Number);
    nowOverride = new Date(y, m - 1, d, actual.getHours(), actual.getMinutes(), actual.getSeconds());
  }

  return {
    systemPrompt: buildSystemPrompt(todos, granularity, categories, activities, customPrompt || DEFAULT_SYSTEM_PROMPT, nowOverride),
    url: settings.apiUrl.replace(/\/$/, '') + '/chat/completions',
    apiKey: settings.apiKey,
    model: settings.model,
  };
}

// --- SSE Reader via XMLHttpRequest (reliable in React Native) ---

const STREAM_IDLE_TIMEOUT_MS = 60_000;

async function* readSSERaw(url: string, headers: Record<string, string>, body: string): AsyncGenerator<string> {
  const xhr = new XMLHttpRequest();
  let resolve: ((v: void) => void) | null = null;
  let finished = false;
  let lastIndex = 0;
  let error: string | null = null;

  xhr.open('POST', url, true);
  for (const [k, v] of Object.entries(headers)) {
    xhr.setRequestHeader(k, v);
  }

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 4 && xhr.status >= 400) {
      error = `AI API 请求失败 (${xhr.status}): ${xhr.responseText?.slice(0, 200)}`;
      finished = true;
      if (resolve) { resolve(); resolve = null; }
    }
  };

  xhr.onprogress = () => {
    if (resolve) { resolve(); resolve = null; }
  };

  xhr.onload = () => {
    finished = true;
    if (resolve) { resolve(); resolve = null; }
  };

  xhr.onerror = () => {
    error = '网络请求失败';
    finished = true;
    if (resolve) { resolve(); resolve = null; }
  };

  xhr.send(body);

  while (!finished || lastIndex < xhr.responseText.length) {
    const newText = xhr.responseText.slice(lastIndex);
    lastIndex = xhr.responseText.length;
    if (newText) yield newText;
    if (!finished && lastIndex >= xhr.responseText.length) {
      await new Promise<void>(r => {
        const timer = setTimeout(() => {
          error = 'AI API 长时间没有返回新数据，请稍后重试';
          finished = true;
          try { xhr.abort(); } catch { /* ignore */ }
          resolve = null;
          r();
        }, STREAM_IDLE_TIMEOUT_MS);
        resolve = () => {
          clearTimeout(timer);
          r();
        };
      });
    }
  }

  if (error) throw new Error(error);
}

function parseSSEChunks(raw: string, prevBuffer: string): { events: string[]; buffer: string } {
  const combined = prevBuffer + raw;
  const parts = combined.split('\n');
  const buffer = parts.pop() || '';
  const events: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      if (data !== '[DONE]') events.push(data);
    }
  }
  return { events, buffer };
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).join('');
  if (value && typeof value === 'object') {
    const obj = value as { text?: unknown; content?: unknown; summary?: unknown };
    return textFromUnknown(obj.text ?? obj.content ?? obj.summary ?? '');
  }
  return '';
}

function getReasoningDelta(delta: Record<string, unknown>): string {
  return textFromUnknown(
    delta.reasoning_content
      ?? delta.reasoning
      ?? delta.thinking
      ?? delta.reasoning_text
      ?? delta.reasoning_details,
  );
}

function sanitizeHistoryForRequest(history: AgentMessage[]): RequestMessage[] {
  return history.flatMap((message): RequestMessage[] => {
    if (message.role === 'tool') return [];
    if (message.role === 'assistant') {
      return message.content ? [{ role: 'assistant', content: message.content }] : [];
    }
    return message.content ? [{ role: 'user', content: message.content }] : [];
  });
}

function cloneRequestMessages(messages: RequestMessage[]): RequestMessage[] {
  return JSON.parse(JSON.stringify(messages)) as RequestMessage[];
}

function buildRequestContext(model: string, messages: RequestMessage[]): AgentRequestContext {
  return {
    model,
    temperature: 0.3,
    stream: true,
    messages: cloneRequestMessages(messages),
    tools,
  };
}

// --- Streaming Agent ---

export async function* streamAgent(history: AgentMessage[], targetDate?: string): AsyncGenerator<StreamEvent> {
  const { systemPrompt, url, apiKey, model } = await buildContext(targetDate);

  const messages: RequestMessage[] = [
    { role: 'system' as const, content: systemPrompt },
    ...sanitizeHistoryForRequest(history),
  ];

  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let fullContent = '';
    const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
    let sseBuffer = '';
    let sawToolDelta = false;

    yield { type: 'request_context', context: buildRequestContext(model, messages) };
    yield { type: 'status', content: round === 0 ? '正在连接模型...' : '正在根据执行结果继续处理...' };

    for await (const chunk of readSSERaw(
      url,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      JSON.stringify({ model, messages, temperature: 0.3, tools, stream: true }),
    )) {
      const { events, buffer } = parseSSEChunks(chunk, sseBuffer);
      sseBuffer = buffer;

      for (const data of events) {
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoning = getReasoningDelta(delta);
          if (reasoning) {
            yield { type: 'reasoning_delta', content: reasoning };
          }

          if (delta.content) {
            fullContent += delta.content;
            yield { type: 'text_delta', content: delta.content };
          }

          if (delta.tool_calls) {
            if (!sawToolDelta) {
              sawToolDelta = true;
              yield { type: 'status', content: '正在准备操作...' };
            }
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap.has(idx)) {
                toolCallMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: '' });
              }
              const entry = toolCallMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }
        } catch { /* skip malformed JSON */ }
      }
    }

    // No tool calls → done
    if (toolCallMap.size === 0) {
      messages.push({ role: 'assistant', content: fullContent });
      yield { type: 'done' };
      return;
    }

    // Build assistant message with tool_calls
    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: fullContent || undefined,
      tool_calls: Array.from(toolCallMap.entries()).map(([idx, tc]) => ({
        id: tc.id || `tool_${round}_${idx}_${tc.name || 'call'}`,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
    messages.push(assistantMsg);

    // Execute tool calls
    for (const [idx, tc] of toolCallMap.entries()) {
      let args: Record<string, unknown>;
      try { args = JSON.parse(tc.arguments); } catch { args = {}; }
      const toolCallId = tc.id || `tool_${round}_${idx}_${tc.name || 'call'}`;

      yield { type: 'status', content: `正在执行 ${tc.name || '操作'}...` };
      yield { type: 'tool_call', id: toolCallId, name: tc.name, args };
      const result = await executeToolAndNotify(tc.name, args);
      yield { type: 'tool_result', id: toolCallId, name: tc.name, result };

      messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) });
    }
  }

  yield { type: 'done' };
}

// --- Non-streaming Agent (fallback) ---

export async function runAgent(userText: string, targetDate?: string): Promise<AgentResult> {
  const settings = await getAISettings();
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('请先在设置中配置 AI API');
  }

  const granularity = await getGranularity();
  const defaultCategories = Object.keys(CategoryIcons);
  const customCategories = await getCustomCategories();
  const categories = [...defaultCategories, ...customCategories.filter(c => !defaultCategories.includes(c))];
  const todos = await getAllTodos();
  const activities = targetDate ? await getRecordsByDate(targetDate) : await getTodayRecords();
  const customPrompt = await getSystemPrompt();

  let nowOverride: Date | undefined;
  if (targetDate) {
    const actual = new Date();
    const [y, m, d] = targetDate.split('-').map(Number);
    nowOverride = new Date(y, m - 1, d, actual.getHours(), actual.getMinutes(), actual.getSeconds());
  }

  const systemPrompt = buildSystemPrompt(todos, granularity, categories, activities, customPrompt || DEFAULT_SYSTEM_PROMPT, nowOverride);

  interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];

  const actions: ActionLog[] = [];
  const MAX_ROUNDS = 5;

  const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      temperature: 0.3,
      tools,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('AI 返回了空结果');

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    const toolCalls: ToolCall[] = assistantMsg.tool_calls || [];

    if (toolCalls.length === 0) {
      // No more tool calls — agent is done
      return {
        summary: assistantMsg.content || '处理完成',
        actions,
      };
    }

    // Execute tool calls
    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeToolAndNotify(tc.function.name, args);
      actions.push({ tool: tc.function.name, args, result });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    summary: '处理完成（已达到最大轮次）',
    actions,
  };
}
