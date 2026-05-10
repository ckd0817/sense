import * as SQLite from 'expo-sqlite';
import { toLocalISO } from './time';

const DB_NAME = 'sense.db';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let db: SQLite.SQLiteDatabase | null = null;
let dbReady: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (dbReady) return dbReady;
  if (db) {
    try {
      await db.getFirstAsync('SELECT 1');
      return db;
    } catch {
      db = null;
    }
  }
  dbReady = (async () => {
    const database = await SQLite.openDatabaseAsync(DB_NAME);
    await initDB(database);
    db = database;
    dbReady = null;
    return database;
  })();
  return dbReady;
}

async function initDB(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      raw_text TEXT NOT NULL,
      activity TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '其他',
      details TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      social TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      recurring INTEGER NOT NULL DEFAULT 0,
      scheduled_time TEXT,
      reminder_advance INTEGER,
      last_completed TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_date TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT DEFAULT '',
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

// --- Records ---

export interface Record {
  id: string;
  created_at: string;
  start_time: string;
  end_time: string | null;
  raw_text: string;
  activity: string;
  category: string;
  details: string;
  mood: string;
  social: string;
  location: string;
}

export async function insertActivity(record: Omit<Record, 'id'>): Promise<string> {
  const database = await getDB();
  const id = generateId();
  await database.runAsync(
    `INSERT INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, record.created_at, record.start_time, record.end_time ?? null, record.raw_text,
     record.activity, record.category, record.details, record.mood, record.social, record.location]
  );
  return id;
}

export async function getRecordsByDate(date: string): Promise<Record[]> {
  const database = await getDB();
  const [y, m, d] = date.split('-').map(Number);
  const start = toLocalISO(new Date(y, m - 1, d, 0, 0, 0, 0));
  const end = toLocalISO(new Date(y, m - 1, d, 23, 59, 59, 999));
  const records = await database.getAllAsync<Record>(
    'SELECT * FROM records WHERE start_time >= ? AND start_time <= ?',
    [start, end]
  );
  return records.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

export async function getTodayRecords(): Promise<Record[]> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return getRecordsByDate(dateStr);
}

export async function getDatesWithActivities(): Promise<string[]> {
  const database = await getDB();
  const records = await database.getAllAsync<Record>(
    'SELECT start_time FROM records ORDER BY start_time DESC'
  );
  const dateSet = new Set<string>();
  for (const r of records) {
    const d = new Date(r.start_time);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dateSet.add(dateStr);
  }
  return Array.from(dateSet);
}

export async function getRecordsByDateRange(startDate: string, endDate: string): Promise<Record[]> {
  const database = await getDB();
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  const start = toLocalISO(new Date(y1, m1 - 1, d1, 0, 0, 0, 0));
  const end = toLocalISO(new Date(y2, m2 - 1, d2, 23, 59, 59, 999));
  const records = await database.getAllAsync<Record>(
    'SELECT * FROM records WHERE start_time >= ? AND start_time <= ?',
    [start, end]
  );
  return records.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

export async function deleteRecord(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM records WHERE id = ?', [id]);
}

export async function updateRecord(id: string, updates: Partial<Omit<Record, 'id'>>): Promise<void> {
  const database = await getDB();
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  if (fields.length === 0) return;
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  await database.runAsync(
    `UPDATE records SET ${setClause} WHERE id = ?`,
    [...values, id]
  );
}

// --- Custom Categories ---

// --- Todos ---

export interface Todo {
  id: string;
  title: string;
  recurring: number;
  scheduled_time: string | null;
  reminder_advance: number | null;
  last_completed: string | null;
  sort_order: number;
  created_at: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getAllTodos(): Promise<Todo[]> {
  const database = await getDB();
  return database.getAllAsync<Todo>('SELECT * FROM todos ORDER BY sort_order, created_at');
}

export async function getTodayTodos(): Promise<Todo[]> {
  return getTodosByDate(todayStr());
}

export async function getTodosByDate(date: string): Promise<Todo[]> {
  const all = await getAllTodos();
  const today = todayStr();
  return all
    .map(t => ({
      ...t,
      last_completed: t.recurring
        ? (t.last_completed === date ? t.last_completed : null)
        : t.last_completed,
    }))
    .filter(t => {
      if (t.recurring) return true;
      if (!t.last_completed) return date === today;
      return date === t.last_completed;
    });
}

export async function addTodo(title: string, recurring: boolean = false, scheduled_time?: string, reminder_advance?: number): Promise<string> {
  const database = await getDB();
  const id = generateId();
  await database.runAsync(
    'INSERT INTO todos (id, title, recurring, scheduled_time, reminder_advance, last_completed, sort_order, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)',
    [id, title, recurring ? 1 : 0, scheduled_time ?? null, reminder_advance ?? null, toLocalISO(new Date())]
  );
  return id;
}

export async function completeTodo(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE todos SET last_completed = ? WHERE id = ?', [todayStr(), id]);
}

export async function uncompleteTodo(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE todos SET last_completed = NULL WHERE id = ?', [id]);
}

export async function deleteTodo(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM todos WHERE id = ?', [id]);
}

export async function updateTodo(id: string, updates: Partial<Pick<Todo, 'title' | 'recurring' | 'scheduled_time' | 'reminder_advance'>>): Promise<void> {
  const database = await getDB();
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  if (fields.length === 0) return;
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  await database.runAsync(`UPDATE todos SET ${setClause} WHERE id = ?`, [...values, id]);
}

export async function findTodoByTitle(title: string): Promise<Todo | null> {
  const database = await getDB();
  const all = await database.getAllAsync<Todo>('SELECT * FROM todos');
  const lower = title.toLowerCase();
  // Exact match first, then substring match
  return all.find(t => t.title.toLowerCase() === lower)
    ?? all.find(t => t.title.toLowerCase().includes(lower) || lower.includes(t.title.toLowerCase()))
    ?? null;
}

export async function getCustomCategories(): Promise<string[]> {
  const val = await getSetting('custom_categories');
  return val ? JSON.parse(val) : [];
}

export async function addCustomCategory(name: string): Promise<void> {
  const existing = await getCustomCategories();
  if (!existing.includes(name)) {
    existing.push(name);
    await setSetting('custom_categories', JSON.stringify(existing));
  }
}

// --- Settings ---

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

export interface AISettings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export async function getAISettings(): Promise<AISettings> {
  return {
    apiUrl: await getSetting('ai_api_url') || '',
    apiKey: await getSetting('ai_api_key') || '',
    model: await getSetting('ai_model') || 'gpt-4o-mini',
  };
}

export async function setAISettings(settings: AISettings): Promise<void> {
  await setSetting('ai_api_url', settings.apiUrl);
  await setSetting('ai_api_key', settings.apiKey);
  await setSetting('ai_model', settings.model);
}

const DEFAULT_REMINDER_TIMES = ['09:00', '12:00', '18:00', '21:00'];

export async function getReminderTimes(): Promise<string[]> {
  const val = await getSetting('reminder_times');
  return val ? JSON.parse(val) : DEFAULT_REMINDER_TIMES;
}

export async function setReminderTimes(times: string[]): Promise<void> {
  await setSetting('reminder_times', JSON.stringify(times));
}

export async function getReminderEnabled(): Promise<boolean> {
  const val = await getSetting('reminder_enabled');
  return val === '1';
}

export async function setReminderEnabled(enabled: boolean): Promise<void> {
  await setSetting('reminder_enabled', enabled ? '1' : '0');
}

export async function getGranularity(): Promise<number> {
  const val = await getSetting('granularity');
  return val ? parseInt(val, 10) : 30;
}

export async function setGranularity(minutes: number): Promise<void> {
  await setSetting('granularity', String(minutes));
}

export async function getTodoReminderAdvance(): Promise<number> {
  const val = await getSetting('todo_reminder_advance');
  return val ? parseInt(val, 10) : 5;
}

export async function setTodoReminderAdvance(minutes: number): Promise<void> {
  await setSetting('todo_reminder_advance', String(minutes));
}

// --- System Prompt ---

export async function getSystemPrompt(): Promise<string | null> {
  return getSetting('system_prompt');
}

export async function setSystemPrompt(prompt: string): Promise<void> {
  await setSetting('system_prompt', prompt);
}

// --- Chat Messages ---

export interface ChatMessage {
  id: string;
  chat_date: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;  // JSON
  tool_call_id: string | null;
  created_at: string;
}

export function getChatDate(): string {
  const now = new Date();
  if (now.getHours() < 6) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function getChatMessages(chatDate: string): Promise<ChatMessage[]> {
  const database = await getDB();
  return database.getAllAsync<ChatMessage>(
    'SELECT * FROM chat_messages WHERE chat_date = ? ORDER BY created_at ASC',
    [chatDate]
  );
}

export async function addChatMessage(msg: { chat_date: string; role: 'user' | 'assistant' | 'tool'; content?: string; tool_calls?: string | null; tool_call_id?: string | null }): Promise<string> {
  const database = await getDB();
  const id = generateId();
  await database.runAsync(
    'INSERT INTO chat_messages (id, chat_date, role, content, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, msg.chat_date, msg.role, msg.content || '', msg.tool_calls ?? null, msg.tool_call_id ?? null, toLocalISO(new Date())]
  );
  return id;
}

export async function clearChatMessages(chatDate: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM chat_messages WHERE chat_date = ?', [chatDate]);
}

export async function getChatDates(): Promise<{ chat_date: string; count: number }[]> {
  const database = await getDB();
  return database.getAllAsync<{ chat_date: string; count: number }>(
    'SELECT chat_date, COUNT(*) as count FROM chat_messages WHERE role != ? GROUP BY chat_date ORDER BY chat_date DESC',
    ['tool']
  );
}

// --- Import / Export ---

export async function exportAllRecords(): Promise<string> {
  const database = await getDB();
  const records = await database.getAllAsync<Record>(
    'SELECT * FROM records ORDER BY start_time ASC'
  );
  const todos = await database.getAllAsync<Todo>(
    'SELECT * FROM todos ORDER BY sort_order, created_at'
  );
  return JSON.stringify({ version: 2, records, todos }, null, 2);
}

export async function importRecords(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (!data.records || !Array.isArray(data.records)) {
    throw new Error('无效的数据格式：缺少 records 数组');
  }
  const database = await getDB();
  let count = 0;
  for (const r of data.records) {
    const id = r.id || generateId();
    await database.runAsync(
      `INSERT OR REPLACE INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, r.created_at, r.start_time, r.end_time ?? null, r.raw_text,
       r.activity ?? '', r.category ?? '其他', r.details ?? '', r.mood ?? '', r.social ?? '', r.location ?? '']
    );
    count++;
  }
  // Import todos if present (v2 format)
  if (data.todos && Array.isArray(data.todos)) {
    for (const t of data.todos) {
      const id = t.id || generateId();
      await database.runAsync(
        `INSERT OR REPLACE INTO todos (id, title, recurring, scheduled_time, reminder_advance, last_completed, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, t.title, t.recurring ?? 0, t.scheduled_time ?? null, t.reminder_advance ?? null, t.last_completed ?? null, t.sort_order ?? 0, t.created_at ?? toLocalISO(new Date())]
      );
      count++;
    }
  }
  return count;
}
