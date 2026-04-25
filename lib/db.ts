import * as SQLite from 'expo-sqlite';

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

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    try {
      await db.getFirstAsync('SELECT 1');
      return db;
    } catch {
      db = null;
    }
  }
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await initDB(db);
  return db;
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
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
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
  const start = new Date(y1, m1 - 1, d1, 0, 0, 0, 0).toISOString();
  const end = new Date(y2, m2 - 1, d2, 23, 59, 59, 999).toISOString();
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

export async function getReminderInterval(): Promise<number> {
  const val = await getSetting('reminder_interval');
  return val ? parseInt(val, 10) : 60;
}

export async function setReminderInterval(minutes: number): Promise<void> {
  await setSetting('reminder_interval', String(minutes));
}

export async function getGranularity(): Promise<number> {
  const val = await getSetting('granularity');
  return val ? parseInt(val, 10) : 30;
}

export async function setGranularity(minutes: number): Promise<void> {
  await setSetting('granularity', String(minutes));
}

// --- Import / Export ---

export async function exportAllRecords(): Promise<string> {
  const database = await getDB();
  const records = await database.getAllAsync<Record>(
    'SELECT * FROM records ORDER BY start_time ASC'
  );
  return JSON.stringify({ version: 1, records }, null, 2);
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
  return count;
}
