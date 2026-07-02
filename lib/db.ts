import * as SQLite from 'expo-sqlite';
import { snapTime, toLocalISO } from './time';

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
      location TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      prediction_status TEXT NOT NULL DEFAULT 'confirmed',
      prediction_batch_id TEXT
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
      reasoning TEXT DEFAULT '',
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prediction_batches (
      id TEXT PRIMARY KEY,
      target_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_records_start_time ON records(start_time);
    CREATE INDEX IF NOT EXISTS idx_prediction_batches_date ON prediction_batches(target_date);
  `);

  await ensureColumn(database, 'records', 'source', "TEXT NOT NULL DEFAULT 'user'");
  await ensureColumn(database, 'records', 'prediction_status', "TEXT NOT NULL DEFAULT 'confirmed'");
  await ensureColumn(database, 'records', 'prediction_batch_id', 'TEXT');
  await ensureColumn(database, 'chat_messages', 'reasoning', "TEXT NOT NULL DEFAULT ''");
  await database.execAsync('CREATE INDEX IF NOT EXISTS idx_records_prediction_batch ON records(prediction_batch_id);');
  await confirmExpiredPredictionsWithDB(database, todayStr());
  await deleteOlderOverlappingRecordsWithDB(database);
}

async function ensureColumn(database: SQLite.SQLiteDatabase, table: string, column: string, definition: string): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some(c => c.name === column)) {
    await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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
  source: 'user' | 'prediction';
  prediction_status: 'pending' | 'confirmed' | 'rejected';
  prediction_batch_id: string | null;
}

export interface PredictionBatch {
  id: string;
  target_date: string;
  status: 'generating' | 'completed' | 'failed' | 'confirmed' | 'rejected';
  model: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export type ActivityInput =
  Omit<Record, 'id' | 'source' | 'prediction_status' | 'prediction_batch_id'> &
  Partial<Pick<Record, 'source' | 'prediction_status' | 'prediction_batch_id'>>;

function dateStartISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return toLocalISO(new Date(y, m - 1, d, 0, 0, 0, 0));
}

function dateEndISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return toLocalISO(new Date(y, m - 1, d, 23, 59, 59, 999));
}

function addMinutesISO(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalISO(d);
}

function normalizeRecordTime(iso: string | null | undefined): string | null {
  return iso ? snapTime(iso, 30) : null;
}

function normalizeTodoTime(iso: string | null | undefined): string | null | undefined {
  if (iso === undefined) return undefined;
  return iso ? snapTime(iso, 30) : null;
}

function normalizeClockTime(time: string): string | null {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const snapped = snapTime(toLocalISO(new Date(2000, 0, 1, h, m, 0, 0)), 30);
  return snapped.slice(11, 16);
}

function normalizeClockTimes(times: string[]): string[] {
  return Array.from(new Set(times.map(normalizeClockTime).filter((t): t is string => !!t))).sort();
}

async function deleteOverlappingRecordsWithDB(
  database: SQLite.SQLiteDatabase,
  startTime: string,
  endTime: string | null,
  excludeId?: string,
): Promise<void> {
  const overlapEnd = endTime ?? addMinutesISO(startTime, 30);
  const params: (string | null)[] = [overlapEnd, startTime];
  let excludeClause = '';
  if (excludeId) {
    excludeClause = 'AND id != ?';
    params.push(excludeId);
  }
  // 预测项软删除（保留数据可恢复），用户记录物理删除
  await database.runAsync(
    `UPDATE records SET prediction_status = 'rejected'
     WHERE source = 'prediction'
       AND prediction_status != 'rejected'
       AND start_time < ?
       AND (end_time IS NULL OR end_time > ?)
       ${excludeClause}`,
    params,
  );
  await database.runAsync(
    `DELETE FROM records
     WHERE source = 'user'
       AND start_time < ?
       AND (end_time IS NULL OR end_time > ?)
       ${excludeClause}`,
    params,
  );
}

function recordsOverlap(a: Record, b: Record): boolean {
  const aStart = new Date(a.start_time).getTime();
  const aEnd = a.end_time ? new Date(a.end_time).getTime() : new Date(addMinutesISO(a.start_time, 30)).getTime();
  const bStart = new Date(b.start_time).getTime();
  const bEnd = b.end_time ? new Date(b.end_time).getTime() : new Date(addMinutesISO(b.start_time, 30)).getTime();
  return aStart < bEnd && bStart < aEnd;
}

async function deleteOlderOverlappingRecordsWithDB(database: SQLite.SQLiteDatabase): Promise<void> {
  const records = await database.getAllAsync<Record>(
    `SELECT * FROM records
     WHERE prediction_status != 'rejected'
     ORDER BY created_at ASC, id ASC`,
  );
  const keep: Record[] = [];
  const deleteIds = new Set<string>();

  for (const record of records) {
    for (const kept of keep) {
      if (!deleteIds.has(kept.id) && recordsOverlap(kept, record)) {
        deleteIds.add(kept.id);
      }
    }
    for (let i = keep.length - 1; i >= 0; i--) {
      if (deleteIds.has(keep[i].id)) keep.splice(i, 1);
    }
    keep.push(record);
  }

  for (const record of records) {
    if (!deleteIds.has(record.id)) continue;
    if (record.source === 'prediction') {
      await database.runAsync("UPDATE records SET prediction_status = 'rejected' WHERE id = ?", [record.id]);
    } else {
      await database.runAsync('DELETE FROM records WHERE id = ?', [record.id]);
    }
  }
}

async function confirmExpiredPredictionsWithDB(database: SQLite.SQLiteDatabase, referenceDate: string): Promise<void> {
  const todayStart = dateStartISO(referenceDate);
  const now = toLocalISO(new Date());
  await database.runAsync(
    `UPDATE records
     SET prediction_status = 'confirmed'
     WHERE source = 'prediction'
       AND prediction_status = 'pending'
       AND start_time < ?`,
    [todayStart],
  );
  await database.runAsync(
    `UPDATE prediction_batches
     SET status = 'confirmed', updated_at = ?
     WHERE target_date < ?
       AND status = 'completed'`,
    [now, referenceDate],
  );
}

export async function confirmExpiredPredictions(referenceDate: string = todayStr()): Promise<void> {
  const database = await getDB();
  await confirmExpiredPredictionsWithDB(database, referenceDate);
}

export async function insertActivity(record: ActivityInput): Promise<string> {
  const database = await getDB();
  const id = generateId();
  const source = record.source ?? 'user';
  const predictionStatus = record.prediction_status ?? (source === 'prediction' ? 'pending' : 'confirmed');
  const startTime = normalizeRecordTime(record.start_time)!;
  const endTime = normalizeRecordTime(record.end_time);
  await database.runAsync(
    `INSERT INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location, source, prediction_status, prediction_batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, record.created_at, startTime, endTime, record.raw_text,
     record.activity, record.category, record.details, record.mood, record.social, record.location,
     source, predictionStatus, record.prediction_batch_id ?? null]
  );
  if (source !== 'prediction') {
    await deleteOverlappingRecordsWithDB(database, startTime, endTime, id);
  }
  return id;
}

export async function getRecordsByDate(date: string): Promise<Record[]> {
  const database = await getDB();
  await confirmExpiredPredictions();
  const start = dateStartISO(date);
  const end = dateEndISO(date);
  const records = await database.getAllAsync<Record>(
    `SELECT * FROM records
     WHERE start_time >= ?
       AND start_time <= ?
       AND prediction_status != 'rejected'`,
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
    `SELECT start_time FROM records
     WHERE prediction_status != 'rejected'
     ORDER BY start_time DESC`
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
  await confirmExpiredPredictions();
  const start = dateStartISO(startDate);
  const end = dateEndISO(endDate);
  const records = await database.getAllAsync<Record>(
    `SELECT * FROM records
     WHERE start_time >= ?
       AND start_time <= ?
       AND prediction_status != 'rejected'`,
    [start, end]
  );
  return records.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

export async function deleteRecord(id: string): Promise<void> {
  const database = await getDB();
  const record = await database.getFirstAsync<Record>('SELECT * FROM records WHERE id = ?', [id]);
  if (record?.source === 'prediction') {
    await database.runAsync("UPDATE records SET prediction_status = 'rejected' WHERE id = ?", [id]);
    return;
  }
  await database.runAsync('DELETE FROM records WHERE id = ?', [id]);
}

export async function updateRecord(id: string, updates: Partial<Omit<Record, 'id'>>): Promise<void> {
  const database = await getDB();
  const existing = await database.getFirstAsync<Record>('SELECT * FROM records WHERE id = ?', [id]);
  const normalized: Partial<Omit<Record, 'id'>> = { ...updates };
  if (updates.start_time !== undefined) normalized.start_time = normalizeRecordTime(updates.start_time) ?? '';
  if (updates.end_time !== undefined) normalized.end_time = normalizeRecordTime(updates.end_time);
  // 编辑 pending 预测视为用户接受，转 confirmed（保留 source）
  if (existing?.source === 'prediction' && existing.prediction_status === 'pending' && !('prediction_status' in updates)) {
    normalized.prediction_status = 'confirmed';
  }
  const fields = Object.keys(normalized);
  const values = Object.values(normalized);
  if (fields.length === 0) return;
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  await database.runAsync(
    `UPDATE records SET ${setClause} WHERE id = ?`,
    [...values, id]
  );
  const updated = await database.getFirstAsync<Record>('SELECT * FROM records WHERE id = ?', [id]);
  if (updated?.source === 'user') {
    await deleteOverlappingRecordsWithDB(database, updated.start_time, updated.end_time, id);
  }
}

export async function getRecordsForPrediction(startDate: string, endDate: string): Promise<Record[]> {
  const database = await getDB();
  await confirmExpiredPredictions();
  const start = dateStartISO(startDate);
  const end = dateEndISO(endDate);
  const records = await database.getAllAsync<Record>(
    `SELECT * FROM records
     WHERE start_time >= ?
       AND start_time <= ?
       AND prediction_status != 'rejected'
       AND (source = 'user' OR prediction_status = 'confirmed')
     ORDER BY start_time ASC`,
    [start, end],
  );
  return records;
}

export async function rejectPredictionRecord(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "UPDATE records SET prediction_status = 'rejected' WHERE id = ? AND source = 'prediction'",
    [id],
  );
}

export async function confirmPredictionRecord(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "UPDATE records SET prediction_status = 'confirmed' WHERE id = ? AND source = 'prediction'",
    [id],
  );
}

export async function confirmPredictionsByDate(date: string): Promise<void> {
  const database = await getDB();
  const now = toLocalISO(new Date());
  await database.runAsync(
    `UPDATE records
     SET prediction_status = 'confirmed'
     WHERE start_time >= ?
       AND start_time <= ?
       AND source = 'prediction'
       AND prediction_status = 'pending'`,
    [dateStartISO(date), dateEndISO(date)],
  );
  await database.runAsync(
    `UPDATE prediction_batches
     SET status = 'confirmed', updated_at = ?
     WHERE target_date = ?
       AND status = 'completed'`,
    [now, date],
  );
}

export async function rejectPredictionsByDate(date: string): Promise<void> {
  const database = await getDB();
  const now = toLocalISO(new Date());
  await database.runAsync(
    `UPDATE records
     SET prediction_status = 'rejected'
     WHERE start_time >= ?
       AND start_time <= ?
       AND source = 'prediction'
       AND prediction_status = 'pending'`,
    [dateStartISO(date), dateEndISO(date)],
  );
  await database.runAsync(
    `UPDATE prediction_batches
     SET status = 'rejected', updated_at = ?
     WHERE target_date = ?`,
    [now, date],
  );
}

export async function getPredictionSummaryByDate(date: string): Promise<{ pending: number; confirmed: number; rejected: number; batch: PredictionBatch | null }> {
  const database = await getDB();
  await confirmExpiredPredictions();
  const rows = await database.getAllAsync<{ prediction_status: Record['prediction_status']; count: number }>(
    `SELECT prediction_status, COUNT(*) as count
     FROM records
     WHERE start_time >= ?
       AND start_time <= ?
       AND source = 'prediction'
     GROUP BY prediction_status`,
    [dateStartISO(date), dateEndISO(date)],
  );
  const summary = { pending: 0, confirmed: 0, rejected: 0, batch: await getPredictionBatchByDate(date) };
  for (const row of rows) summary[row.prediction_status] = row.count;
  return summary;
}

export async function getPredictionBatchByDate(date: string): Promise<PredictionBatch | null> {
  const database = await getDB();
  return database.getFirstAsync<PredictionBatch>(
    'SELECT * FROM prediction_batches WHERE target_date = ?',
    [date],
  );
}

export async function createPredictionBatch(date: string, model: string): Promise<PredictionBatch | null> {
  const database = await getDB();
  const id = generateId();
  const now = toLocalISO(new Date());
  const result = await database.runAsync(
    `INSERT OR IGNORE INTO prediction_batches (id, target_date, status, model, error, created_at, updated_at)
     VALUES (?, ?, 'generating', ?, '', ?, ?)`,
    [id, date, model, now, now],
  );
  if (result.changes === 0) return null;
  return getPredictionBatchByDate(date);
}

export async function completePredictionBatch(batch: PredictionBatch, records: ActivityInput[]): Promise<void> {
  const database = await getDB();
  const now = toLocalISO(new Date());
  await database.withExclusiveTransactionAsync(async (txn) => {
    for (const record of records) {
      const id = generateId();
      const startTime = normalizeRecordTime(record.start_time)!;
      const endTime = normalizeRecordTime(record.end_time);
      await txn.runAsync(
        `INSERT INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location, source, prediction_status, prediction_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prediction', 'confirmed', ?)`,
        [id, now, startTime, endTime, record.raw_text, record.activity, record.category, record.details, record.mood, record.social, record.location, batch.id],
      );
    }
    await txn.runAsync(
      "UPDATE prediction_batches SET status = 'completed', error = '', updated_at = ? WHERE id = ?",
      [now, batch.id],
    );
  });
}

export async function failPredictionBatch(batchId: string, error: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "UPDATE prediction_batches SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    [error.slice(0, 500), toLocalISO(new Date()), batchId],
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
  const scheduledTime = normalizeTodoTime(scheduled_time) ?? null;
  await database.runAsync(
    'INSERT INTO todos (id, title, recurring, scheduled_time, reminder_advance, last_completed, sort_order, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?)',
    [id, title, recurring ? 1 : 0, scheduledTime, reminder_advance ?? null, toLocalISO(new Date())]
  );
  return id;
}

export async function completeTodo(id: string, date?: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE todos SET last_completed = ? WHERE id = ?', [date ?? todayStr(), id]);
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
  const normalized = { ...updates };
  if ('scheduled_time' in updates) normalized.scheduled_time = normalizeTodoTime(updates.scheduled_time) ?? null;
  const fields = Object.keys(normalized);
  const values = Object.values(normalized);
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
  return normalizeClockTimes(val ? JSON.parse(val) : DEFAULT_REMINDER_TIMES);
}

export async function setReminderTimes(times: string[]): Promise<void> {
  await setSetting('reminder_times', JSON.stringify(normalizeClockTimes(times)));
}

export async function getReminderEnabled(): Promise<boolean> {
  const val = await getSetting('reminder_enabled');
  return val === '1';
}

export async function setReminderEnabled(enabled: boolean): Promise<void> {
  await setSetting('reminder_enabled', enabled ? '1' : '0');
}

export async function getGranularity(): Promise<number> {
  return 30;
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
  reasoning: string;
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

export async function addChatMessage(msg: { chat_date: string; role: 'user' | 'assistant' | 'tool'; content?: string; reasoning?: string; tool_calls?: string | null; tool_call_id?: string | null }): Promise<string> {
  const database = await getDB();
  const id = generateId();
  await database.runAsync(
    'INSERT INTO chat_messages (id, chat_date, role, content, reasoning, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, msg.chat_date, msg.role, msg.content || '', msg.reasoning || '', msg.tool_calls ?? null, msg.tool_call_id ?? null, toLocalISO(new Date())]
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
  const predictionBatches = await database.getAllAsync<PredictionBatch>(
    'SELECT * FROM prediction_batches ORDER BY target_date ASC'
  );
  return JSON.stringify({ version: 3, records, todos, predictionBatches }, null, 2);
}

export async function importRecords(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (!data.records || !Array.isArray(data.records)) {
    throw new Error('无效的数据格式：缺少 records 数组');
  }
  const database = await getDB();
  let count = 0;
  await database.withExclusiveTransactionAsync(async (txn) => {
    for (const r of data.records) {
      const id = r.id || generateId();
      await txn.runAsync(
        `INSERT OR REPLACE INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location, source, prediction_status, prediction_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, r.created_at, r.start_time, r.end_time ?? null, r.raw_text,
         r.activity ?? '', r.category ?? '其他', r.details ?? '', r.mood ?? '', r.social ?? '', r.location ?? '',
         r.source ?? 'user', r.prediction_status ?? 'confirmed', r.prediction_batch_id ?? null]
      );
      count++;
    }
    // Import todos if present (v2 format)
    if (data.todos && Array.isArray(data.todos)) {
      for (const t of data.todos) {
        const id = t.id || generateId();
        await txn.runAsync(
          `INSERT OR REPLACE INTO todos (id, title, recurring, scheduled_time, reminder_advance, last_completed, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, t.title, t.recurring ?? 0, normalizeTodoTime(t.scheduled_time) ?? null, t.reminder_advance ?? null, t.last_completed ?? null, t.sort_order ?? 0, t.created_at ?? toLocalISO(new Date())]
        );
        count++;
      }
    }
    if (data.predictionBatches && Array.isArray(data.predictionBatches)) {
      for (const b of data.predictionBatches) {
        const id = b.id || generateId();
        await txn.runAsync(
          `INSERT OR REPLACE INTO prediction_batches (id, target_date, status, model, error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            b.target_date,
            b.status ?? 'completed',
            b.model ?? '',
            b.error ?? '',
            b.created_at ?? toLocalISO(new Date()),
            b.updated_at ?? toLocalISO(new Date()),
          ]
        );
        count++;
      }
    }
  });
  return count;
}

export async function deletePredictionBatch(batchId: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM prediction_batches WHERE id = ?', [batchId]);
}
