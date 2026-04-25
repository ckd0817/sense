import { getAISettings, AISettings, getCustomCategories, addCustomCategory } from './db';
import { toLocalISO } from './time';
import { CategoryIcons } from '../constants/theme';

const BASE_PROMPT = `你是一个日程记录助手。用户会用自然语言描述他们的活动，你需要将描述提取为结构化的 JSON 数据。

当前时间：{CURRENT_TIME}
时间粒度：{GRANULARITY}分钟。所有时间的分钟部分四舍五入到最近的粒度边界（如粒度30分钟，则 11:37→11:30，12:55→13:00，14:15→14:30）。

提取规则：
- 从用户描述中解析出所有活动，返回 activities 数组
- 每个活动包含：
  1. activity: 简短的活动名称（如"午餐"、"上课"、"散步"）
  2. category: 活动分类。优先从以下已有分类中选择：{CATEGORIES}。如果没有合适的，可以创建一个新的分类名（必须是2个字）
  3. details: 活动的具体细节描述（如果用户提到了情绪感受或同行人物，也应包含在详情中）
  4. mood: 用户提到的情绪或感受，未提及则为空字符串
  5. social: 和谁在一起，未提及则为空字符串
  6. location: 在哪里，未提及则为空字符串
  7. start_time: 活动开始时间（格式如 "2026-04-24T11:30:00"，不要带时区和Z）
  8. end_time: 活动结束时间（格式同上，不要带时区和Z）

时间推算规则：
- 根据当前时间和用户的相对时间描述推算具体时间
- 如"一小时前吃的饭" → start_time = 当前时间 - 1小时
- 如"吃了半小时" → 从 start_time 推算 end_time
- 如"刚才" → 估算为最近的时间
- 如果用户描述了多个连续活动，按时间顺序排列，前后活动的时间应该衔接
- 如果无法确定精确时间，合理估算
- 所有时间必须对齐到{GRANULARITY}分钟粒度

注意：
- 只提取用户明确提到的信息，不要编造
- 保持简洁准确
- 一条描述可能包含多个活动

请只返回 JSON，不要返回其他内容。`;

export interface StructuredActivity {
  activity: string;
  category: string;
  details: string;
  mood: string;
  social: string;
  location: string;
  start_time: string;
  end_time: string;
}

export async function testConnection(settings: AISettings): Promise<string> {
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error('请先填写完整的 API 配置');
  }

  const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败 (${response.status}): ${errorText.slice(0, 100)}`);
  }

  return '连接成功';
}

export async function processInput(rawText: string, granularity: number = 30): Promise<{ activities: StructuredActivity[] }> {
  const settings = await getAISettings();

  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('请先在设置中配置 AI API');
  }

  // Build dynamic category list
  const defaultCategories = Object.keys(CategoryIcons);
  const customCategories = await getCustomCategories();
  const allCategories = [...defaultCategories, ...customCategories.filter(c => !defaultCategories.includes(c))];
  const categoryList = allCategories.join('、');

  const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';
  const systemPrompt = BASE_PROMPT
    .replace(/{CURRENT_TIME}/g, toLocalISO(new Date()))
    .replace(/{GRANULARITY}/g, String(granularity))
    .replace(/{CATEGORIES}/g, categoryList);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawText },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API 请求失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI 返回了空结果');
  }

  let parsed: { activities: StructuredActivity[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI 返回了无效的 JSON');
  }

  if (!parsed.activities || !Array.isArray(parsed.activities) || parsed.activities.length === 0) {
    throw new Error('AI 未解析出活动');
  }

  // Save any new categories
  for (const a of parsed.activities) {
    if (a.category && !allCategories.includes(a.category)) {
      await addCustomCategory(a.category);
      allCategories.push(a.category);
    }
  }

  return parsed;
}
