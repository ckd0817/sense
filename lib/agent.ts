import { DeviceEventEmitter } from 'react-native';
import { getAISettings, getGranularity, getCustomCategories, addCustomCategory, getAllTodos, addTodo, updateTodo, completeTodo, uncompleteTodo, findTodoByTitle, getTodayRecords, getRecordsByDate, getRecordsByDateRange, applyActivityChanges, ActivityChangeRequest, ActivityChangeResult, getSystemPrompt, Record as ActivityRecord } from './db';
import { scheduleTodoReminder, cancelTodoReminder } from './notifications';
import { CategoryIcons } from '../constants/theme';
import { toLocalISO } from './time';

export const DATA_CHANGED_EVENT = 'sense-data-changed';
export const FOCUS_ASSISTANT_EVENT = 'sense-focus-assistant';

export interface ActivityDateRange {
  start_date: string;
  end_date: string;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Tool Definitions (OpenAI function calling format) ---

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'apply_activity_changes',
      description: '原子地应用一组活动变更。创建、修改和删除都通过 operations 数组提交；单条操作也必须放在数组中。',
      parameters: {
        type: 'object',
        properties: {
          request_id: { type: 'string', description: '本次变更的唯一请求 ID。每次新调用生成新的稳定字符串，重试同一次调用时保持不变。' },
          scope: {
            type: 'object',
            description: '本批活动允许读取和修改的日期范围。',
            properties: {
              start_date: { type: 'string', description: '开始日期，格式 YYYY-MM-DD。' },
              end_date: { type: 'string', description: '结束日期，格式 YYYY-MM-DD。' },
            },
            required: ['start_date', 'end_date'],
          },
          atomic: { type: 'boolean', description: '是否整批原子执行，必须为 true。默认 true。' },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            description: '需要执行的活动操作。按用户描述一次性列出所有相关变更。',
            items: {
              type: 'object',
              properties: {
                op_id: { type: 'string', description: '本次调用内唯一的操作编号，如 op-1。' },
                action: { type: 'string', enum: ['create', 'update', 'delete'], description: '创建、修改或删除。' },
                record_id: { type: 'string', description: '修改或删除的精确活动 ID。选中活动上下文提供 ID 时必须使用。' },
                match: {
                  type: 'object',
                  description: '没有 record_id 时的兜底匹配条件。',
                  properties: {
                    activity: { type: 'string', description: '原活动名称。' },
                    start_time: { type: 'string', description: '原开始时间，用于区分同名活动。' },
                  },
                },
                data: {
                  type: 'object',
                  description: 'create 的活动数据，或 update 要修改的字段。delete 不需要 data。',
                  properties: {
                    activity: { type: 'string', description: '活动名称。' },
                    category: { type: 'string', description: '活动分类。' },
                    start_time: { type: 'string', description: '开始时间，例如 2026-07-19T14:30:00，不带时区和 Z。' },
                    end_time: { type: ['string', 'null'], description: '结束时间；仍在进行可为 null。' },
                    details: { type: 'string', description: '活动细节。' },
                    mood: { type: 'string', description: '情绪感受。' },
                    social: { type: 'string', description: '和谁在一起。' },
                    location: { type: 'string', description: '地点。' },
                  },
                },
              },
              required: ['op_id', 'action'],
            },
          },
        },
        required: ['request_id', 'scope', 'operations'],
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

// --- System Prompt ---

export const DEFAULT_SYSTEM_PROMPT = `你是一个日程管理和记录助手。用户用自然语言描述他们的活动、计划和习惯，你通过调用工具来帮助他们管理。

当前时间：{{current_time}}
时间粒度：{{granularity}}分钟。所有时间的分钟部分四舍五入到最近的粒度边界。
可用分类：{{categories}}

## 当前待办列表
{{todo_list}}

## 关于 [预测] 标签
活动列表中带 [预测] 标签的是之前自动预测生成的活动，仅作为占位参考，不一定准确。当用户描述的实际情况与预测不一致时，使用 apply_activity_changes 修改、删除或替换预测，不要把预测当作权威事实。

## 当前日期活动列表
{{activity_list}}

## 工具使用规则

### 核心判断：活动 vs 待办
根据描述的时间与当前时间的关系判断：
- **时间在当前之前或正在发生** → 活动（apply_activity_changes）：过去的事
- **时间在当前之后** → 待办（create_todo）：未来的计划
- 没有明确时间的习惯性描述（"我要每天X"）→ 待办（create_todo, recurring=true）

### 记录活动
用户描述已经发生或正在进行的事情 → 调用 apply_activity_changes，action=create。
如果该活动恰好匹配某个未完成的待办 → 同时调用 update_todo(title="...", completed=true)。
用户继续做同一件事（连续同类活动）→ 在批次中 action=update，延长 end_time。
用户补充或修正已有活动信息 → action=update。
如果用户描述的是对已有活动、预测活动或同一时间段活动的修正 → 优先修改原记录，不要新建重复活动。

### 批量修改活动
- 一条用户消息涉及多段活动时，只调用一次 apply_activity_changes，把所有 create、update、delete 放进同一个 operations 数组。
- 单条修改也使用 operations 数组，数组中只有一项。
- 当前选中活动有 record_id 时，修改或删除必须使用该 ID，不要再次按名称猜测。
- 未选中具体活动时，优先使用活动列表中的 ID；确实无法确定才使用 match.activity 和 match.start_time。
- 每个 operation 使用不同的 op_id，atomic 必须为 true，scope 使用当前可见日期范围。
- 工具返回失败时，不要改用多个旧工具绕过原子校验；根据错误询问用户或调整整批参数后重试。

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
- 对于 action=create 的 category，优先从可用分类中选择
- 如果没有合适的分类，可以自创分类名（简洁两字词），新分类会自动保存供后续复用
- operation.data.start_time 表示要保存的新开始时间；如果只是为了定位原记录，使用 operation.match.start_time
- 同一个时间段只能有一个活动；如果新活动时间段和已有活动重叠，后来的真实活动会覆盖前面的活动
- create_todo 如果用户指定了 scheduled_time 但没有指定提前提醒时间，默认设置 reminder_advance=10（分钟）`;

const RUNTIME_SYSTEM_GUARDRAILS = `## 运行约束
- 用户请求可以直接落库或修改时，优先调用工具，不要先输出长篇解释。
- 思考保持简短，不要反复讨论同一个时间边界；做出最合理的半小时归并后继续执行。
- 所有活动、待办时间会被四舍五入到最近的半小时边界（:00–:14→:00，:15–:44→:30，:45–:59→下一个整点）。
- 如果归并后会导致活动重叠或 0 时长，调整 end_time 让时间线保持连续、非重叠。
- 一条消息包含多段活动时，必须在一次 apply_activity_changes 调用中提交全部活动变更，然后再用一句话总结处理结果。`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function shouldIncludeTodoInPrompt(todo: { recurring: number; last_completed: string | null }, promptDate: string): boolean {
  if (todo.recurring) return todo.last_completed !== promptDate;
  return !todo.last_completed;
}

function buildSystemPrompt(todos: { title: string; recurring: number; last_completed: string | null; scheduled_time: string | null }[], granularity: number, categories: string[], activities: ActivityRecord[], template: string, nowOverride?: Date, selectedActivities: ActivityRecord[] = []): string {
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
        const parts = [`- [id:${r.id}] ${r.start_time.slice(0, 10)} ${r.activity}（${time}）`];
        if (r.category && r.category !== '其他') parts[0] += ` [${r.category}]`;
        if (r.source === 'prediction') parts[0] += ` [预测]`;
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

  const selectedSection = selectedActivities.length > 0
    ? `## 当前选中的活动\n用户从活动页明确选中了以下记录。涉及“这个、刚才、它”等指代时，必须使用对应 record_id：\n${selectedActivities.map(record => `- [id:${record.id}] ${record.activity}（${formatTime(record.start_time)}-${record.end_time ? formatTime(record.end_time) : '现在'}）`).join('\n')}`
    : '## 当前选中的活动\n（无）';

  return `${rendered}\n\n${selectedSection}\n\n${RUNTIME_SYSTEM_GUARDRAILS}`;
}

// --- Tool Executor ---

export type ToolExecutionResult =
  | ActivityChangeResult
  | { success: boolean; message?: string; id?: string };

async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'apply_activity_changes': {
        const request = args as unknown as ActivityChangeRequest;
        const result = await applyActivityChanges({ ...request, atomic: true });
        const categories = request.operations
          .map(operation => operation.data?.category)
          .filter((category): category is string => !!category);
        if (categories.length > 0) {
          const defaultCategories = Object.keys(CategoryIcons);
          const custom = await getCustomCategories();
          const known = new Set([...defaultCategories, ...custom]);
          for (const category of categories) {
            if (!known.has(category)) {
              await addCustomCategory(category);
              known.add(category);
            }
          }
        }
        return result;
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
        const nextScheduledTime = updates.scheduled_time !== undefined ? updates.scheduled_time : todo.scheduled_time;
        if (nextScheduledTime) {
          const advance = updates.reminder_advance ?? todo.reminder_advance ?? 10;
          await scheduleTodoReminder(todo.id, updates.title ?? todo.title, nextScheduledTime, advance);
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
      default:
        return { success: false, message: `未知工具: ${name}` };
    }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : '执行失败' };
  }
}

async function executeToolAndNotify(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const result = await executeTool(name, args);
  if (result.success) {
    DeviceEventEmitter.emit(DATA_CHANGED_EVENT, {
      tool: name,
      changedRecordIds: 'changed_record_ids' in result ? result.changed_record_ids : [],
    });
  }
  return result;
}

// --- Stream Types ---

export type StreamEvent =
  | { type: 'request_context'; context: AgentRequestContext }
  | { type: 'round_complete'; reasoning: string; content: string }
  | { type: 'status'; content: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: ToolExecutionResult }
  | { type: 'done' };

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// --- Build context ---

async function buildContext(targetDate?: string, selectedActivities: ActivityRecord[] = [], visibleDateRange?: ActivityDateRange): Promise<{ systemPrompt: string; url: string; apiKey: string; model: string }> {
  const settings = await getAISettings();
  if (!settings.apiUrl || !settings.apiKey) throw new Error('请先在设置中配置 AI API');

  const granularity = await getGranularity();
  const defaultCategories = Object.keys(CategoryIcons);
  const customCategories = await getCustomCategories();
  const categories = [...defaultCategories, ...customCategories.filter(c => !defaultCategories.includes(c))];
  const todos = await getAllTodos();
  const activities = visibleDateRange
    ? await getRecordsByDateRange(visibleDateRange.start_date, visibleDateRange.end_date)
    : targetDate
      ? await getRecordsByDate(targetDate)
      : await getTodayRecords();
  const customPrompt = await getSystemPrompt();

  let nowOverride: Date | undefined;
  if (targetDate) {
    const actual = new Date();
    const [y, m, d] = targetDate.split('-').map(Number);
    nowOverride = new Date(y, m - 1, d, actual.getHours(), actual.getMinutes(), actual.getSeconds());
  }

  return {
    systemPrompt: buildSystemPrompt(todos, granularity, categories, activities, customPrompt || DEFAULT_SYSTEM_PROMPT, nowOverride, selectedActivities),
    url: settings.apiUrl.replace(/\/$/, '') + '/chat/completions',
    apiKey: settings.apiKey,
    model: settings.model,
  };
}

// --- Response parsing helpers ---

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
    stream: false,
    messages: cloneRequestMessages(messages),
    tools,
  };
}

// --- Streaming Agent ---

export async function* streamAgent(history: AgentMessage[], targetDate?: string, selectedActivities: ActivityRecord[] = [], visibleDateRange?: ActivityDateRange): AsyncGenerator<StreamEvent> {
  const { systemPrompt, url, apiKey, model } = await buildContext(targetDate, selectedActivities, visibleDateRange);

  const messages: RequestMessage[] = [
    { role: 'system' as const, content: systemPrompt },
    ...sanitizeHistoryForRequest(history),
  ];

  const MAX_ROUNDS = 5;

  let accReasoning = '';
  let accContent = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const requestBody = JSON.stringify({ model, messages, temperature: 0.3, tools, max_tokens: 8192 });
    yield { type: 'request_context', context: buildRequestContext(model, messages) };
    yield { type: 'status', content: round === 0 ? '正在连接模型...' : '正在根据执行结果继续处理...' };

    let responseJson: any;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: requestBody,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`AI API 请求失败 (${response.status}): ${text.slice(0, 300)}`);
      }
      responseJson = JSON.parse(text);
    } catch (e) {
      throw e;
    }

    const choice = responseJson.choices?.[0];
    if (!choice) {
      throw new Error('AI API 未返回 choices');
    }
    const message = choice.message || {};
    const finishReason = choice.finish_reason;

    const reasoning = getReasoningDelta(message);
    if (reasoning) accReasoning += reasoning;

    let fullContent = '';
    if (typeof message.content === 'string') {
      fullContent = message.content;
      accContent += message.content;
    }

    const toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = message.tool_calls || [];

    yield { type: 'round_complete', reasoning: accReasoning, content: accContent };

    if (finishReason === 'length') {
      yield { type: 'status', content: '⚠️ 输出达到模型 token 上限，已截断。可尝试缩短上下文或分段请求。' };
    }

    // No tool calls → done
    if (toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: fullContent });
      yield { type: 'done' };
      return;
    }

    // Build assistant message with tool_calls
    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: fullContent || undefined,
      tool_calls: toolCalls.map((tc, idx) => ({
        id: tc.id || `tool_${round}_${idx}_${tc.function?.name || 'call'}`,
        type: 'function' as const,
        function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
      })),
    };
    messages.push(assistantMsg);

    // Execute tool calls
    for (let idx = 0; idx < toolCalls.length; idx++) {
      const tc = toolCalls[idx];
      const name = tc.function?.name || '';
      let args: Record<string, unknown>;
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
      const toolCallId = tc.id || `tool_${round}_${idx}_${name || 'call'}`;
      if (name === 'apply_activity_changes') {
        args.request_id = toolCallId;
        args.atomic = true;
        args.scope = visibleDateRange ?? {
          start_date: targetDate ?? todayDateStr(),
          end_date: targetDate ?? todayDateStr(),
        };
        delete args.target_date;
      }

      yield { type: 'status', content: `正在执行 ${name || '操作'}...` };
      yield { type: 'tool_call', id: toolCallId, name, args };
      const result = await executeToolAndNotify(name, args);
      yield { type: 'tool_result', id: toolCallId, name, result };

      messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result) });
    }
  }

  yield { type: 'done' };
}
