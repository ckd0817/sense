import { CategoryIcons } from '../constants/theme';
import {
  ActivityInput,
  addCustomCategory,
  completePredictionBatch,
  confirmExpiredPredictions,
  createPredictionBatch,
  failPredictionBatch,
  getAISettings,
  getAllTodos,
  getCustomCategories,
  getPredictionBatchByDate,
  getRecordsForPrediction,
} from './db';
import { snapTime, toLocalISO } from './time';

const LOOKBACK_DAYS = 30;
const GRANULARITY = 30;

interface PredictedActivity {
  activity?: unknown;
  category?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  details?: unknown;
  mood?: unknown;
  social?: unknown;
  location?: unknown;
}

interface PredictionResponse {
  activities?: PredictedActivity[];
}

export interface PredictionRunResult {
  status: 'generated' | 'skipped' | 'failed';
  reason?: string;
  count?: number;
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function localDateTime(date: string, hour: number, minute: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return toLocalISO(new Date(y, m - 1, d, hour, minute, 0, 0));
}

function formatRecordLine(r: { start_time: string; end_time: string | null; activity: string; category: string; details: string; location: string }): string {
  const start = r.start_time.slice(0, 16).replace('T', ' ');
  const end = r.end_time ? r.end_time.slice(11, 16) : '现在';
  const parts = [`${start}-${end}`, r.activity, `[${r.category}]`];
  if (r.details) parts.push(r.details);
  if (r.location) parts.push(`地点:${r.location}`);
  return parts.join(' ');
}

function buildPrompt(targetDate: string, categories: string[], historyLines: string[], todoLines: string[]): string {
  const target = new Date(`${targetDate}T00:00:00`);
  const weekday = '日一二三四五六'[target.getDay()];
  return `你是 Sense 的日程预测引擎。请根据用户过去 ${LOOKBACK_DAYS} 天的已确认记录，预测目标日期一整天的生活轨迹。

目标日期：${targetDate}（周${weekday}）
时间粒度：固定 ${GRANULARITY} 分钟。所有 start_time 和 end_time 必须落在 :00 或 :30。
可用分类：${categories.join('、')}

过去记录：
${historyLines.length ? historyLines.join('\n') : '（无历史记录，仍然要根据普通生活规律预测一整天）'}

当前待办/习惯：
${todoLines.length ? todoLines.join('\n') : '（无）'}

要求：
- 预测 00:00 到 24:00 的主要活动块，包含睡眠、起床、洗漱、用餐、通勤、工作/学习、休息等可能活动。
- 根据工作日/周末和过去记录的重复模式判断，不接入节假日。
- 活动不能重叠，按时间升序。
- 不要输出解释，只返回 JSON。
- JSON 格式：{"activities":[{"activity":"睡觉","category":"休息","start_time":"${targetDate}T00:00:00","end_time":"${targetDate}T07:30:00","details":"","mood":"","social":"","location":""}]}`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePredictions(targetDate: string, raw: PredictedActivity[]): ActivityInput[] {
  const dayStart = localDateTime(targetDate, 0, 0);
  const nextDay = localDateTime(dateStr(addDays(new Date(`${targetDate}T00:00:00`), 1)), 0, 0);
  const normalized: ActivityInput[] = [];
  for (const item of raw) {
    const activity = asString(item.activity);
    if (!activity) continue;
    const startRaw = asString(item.start_time);
    if (!startRaw) continue;
    let start = snapTime(startRaw, GRANULARITY);
    let end = normalizeEndTime(asString(item.end_time), start);
    if (start < dayStart) start = dayStart;
    if (start >= nextDay) continue;
    if (end > nextDay) end = nextDay;
    if (end <= start) end = addMinutes(start, GRANULARITY);
    if (end > nextDay) end = nextDay;
    if (end <= start) continue;
    normalized.push({
      created_at: toLocalISO(new Date()),
      start_time: start,
      end_time: end,
      raw_text: 'AI prediction',
      activity,
      category: asString(item.category) || '其他',
      details: asString(item.details),
      mood: asString(item.mood),
      social: asString(item.social),
      location: asString(item.location),
      source: 'prediction',
      prediction_status: 'pending',
    });
  }
  normalized.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const result: ActivityInput[] = [];
  let cursor = dayStart;
  for (const item of normalized) {
    let start = item.start_time < cursor ? cursor : item.start_time;
    let end = item.end_time ?? addMinutes(start, GRANULARITY);
    if (start >= nextDay) continue;
    if (end <= start) end = addMinutes(start, GRANULARITY);
    if (end > nextDay) end = nextDay;
    if (end <= start) continue;
    result.push({ ...item, start_time: start, end_time: end });
    cursor = end;
  }
  return result.slice(0, 96);
}

function normalizeEndTime(endRaw: string, start: string): string {
  if (!endRaw) return addMinutes(start, GRANULARITY);
  return snapTime(endRaw, GRANULARITY);
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalISO(d);
}

async function fetchPrediction(targetDate: string, prompt: string): Promise<PredictionResponse> {
  const settings = await getAISettings();
  const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: '你只输出可解析 JSON，不输出 Markdown。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回了空结果');

  try {
    return JSON.parse(content) as PredictionResponse;
  } catch {
    throw new Error(`AI 返回了无效 JSON，目标日期 ${targetDate}`);
  }
}

export async function ensureDailyPrediction(targetDate: string = dateStr(new Date())): Promise<PredictionRunResult> {
  await confirmExpiredPredictions(targetDate);

  const settings = await getAISettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    return { status: 'skipped', reason: 'missing_ai_settings' };
  }

  const existing = await getPredictionBatchByDate(targetDate);
  if (existing) {
    return { status: 'skipped', reason: existing.status };
  }

  const batch = await createPredictionBatch(targetDate, settings.model);
  if (!batch) return { status: 'skipped', reason: 'already_exists' };

  try {
    const target = new Date(`${targetDate}T00:00:00`);
    const startDate = dateStr(addDays(target, -LOOKBACK_DAYS));
    const endDate = dateStr(addDays(target, -1));
    const [records, todos, customCategories] = await Promise.all([
      getRecordsForPrediction(startDate, endDate),
      getAllTodos(),
      getCustomCategories(),
    ]);
    const categories = [...Object.keys(CategoryIcons), ...customCategories.filter(c => !Object.keys(CategoryIcons).includes(c))];
    const historyLines = records.map(formatRecordLine);
    const todoLines = todos.map(t => {
      const type = t.recurring ? '每日习惯' : '临时待办';
      const time = t.scheduled_time ? ` ${t.scheduled_time}` : '';
      return `- ${t.title} (${type}${time})`;
    });
    const prompt = buildPrompt(targetDate, categories, historyLines, todoLines);
    const response = await fetchPrediction(targetDate, prompt);
    const activities = normalizePredictions(targetDate, response.activities ?? []);
    if (activities.length === 0) throw new Error('AI 未返回可用预测活动');

    for (const activity of activities) {
      if (activity.category && !categories.includes(activity.category)) {
        await addCustomCategory(activity.category);
        categories.push(activity.category);
      }
    }

    await completePredictionBatch(batch, activities);
    return { status: 'generated', count: activities.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : '预测生成失败';
    await failPredictionBatch(batch.id, message);
    return { status: 'failed', reason: message };
  }
}
