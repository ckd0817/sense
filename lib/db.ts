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
  if (!db) {
    try {
      db = await SQLite.openDatabaseAsync(DB_NAME);
      await initDB(db);
    } catch {
      // Stale connection after hot reload — reopen
      db = await SQLite.openDatabaseAsync(DB_NAME);
      await initDB(db);
    }
  }
  return db;
}

async function initDB(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    DROP TABLE IF EXISTS records;

    CREATE TABLE records (
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

  // Seed test data
  try {
    await seedTestData(database);
  } catch {}
}

async function seedTestData(database: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const dayBefore = new Date(now); dayBefore.setDate(dayBefore.getDate() - 2);
  const dayBeforeStr = `${dayBefore.getFullYear()}-${String(dayBefore.getMonth() + 1).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}`;

  const seedData = [
    // Today
    { created_at: `${today}T07:30:00`, start_time: `${today}T07:00:00`, end_time: `${today}T07:30:00`, raw_text: '早上跑步', activity: '晨跑', category: '运动', details: '绕操场跑了三圈', mood: '精神', social: '', location: '操场' },
    { created_at: `${today}T08:15:00`, start_time: `${today}T08:00:00`, end_time: `${today}T08:30:00`, raw_text: '吃早饭', activity: '早餐', category: '饮食', details: '豆浆油条', mood: '', social: '', location: '食堂' },
    { created_at: `${today}T10:10:00`, start_time: `${today}T08:30:00`, end_time: `${today}T10:00:00`, raw_text: '上了两节数学课', activity: '数学课', category: '学习', details: '学了线性代数', mood: '还行', social: '', location: '教学楼' },
    { created_at: `${today}T12:10:00`, start_time: `${today}T11:30:00`, end_time: `${today}T12:30:00`, raw_text: '和同学在食堂吃午饭', activity: '午餐', category: '饮食', details: '吃了饺子', mood: '满足', social: '同学', location: '食堂' },
    { created_at: `${today}T14:10:00`, start_time: `${today}T13:00:00`, end_time: `${today}T14:00:00`, raw_text: '午休', activity: '午休', category: '休息', details: '睡了一小时', mood: '舒服', social: '', location: '宿舍' },
    { created_at: `${today}T17:10:00`, start_time: `${today}T14:00:00`, end_time: `${today}T17:00:00`, raw_text: '写代码', activity: '编程', category: '工作', details: '做了一个App', mood: '有成就感', social: '', location: '图书馆' },
    { created_at: `${today}T18:10:00`, start_time: `${today}T17:30:00`, end_time: `${today}T18:30:00`, raw_text: '打篮球', activity: '篮球', category: '运动', details: '打了全场', mood: '累但开心', social: '室友', location: '体育馆' },
    // Yesterday
    { created_at: `${yesterdayStr}T08:10:00`, start_time: `${yesterdayStr}T08:00:00`, end_time: `${yesterdayStr}T08:30:00`, raw_text: '吃早饭', activity: '早餐', category: '饮食', details: '包子粥', mood: '', social: '', location: '食堂' },
    { created_at: `${yesterdayStr}T12:10:00`, start_time: `${yesterdayStr}T10:00:00`, end_time: `${yesterdayStr}T12:00:00`, raw_text: '上英语课', activity: '英语课', category: '学习', details: '听力练习', mood: '', social: '', location: '教学楼' },
    { created_at: `${yesterdayStr}T14:10:00`, start_time: `${yesterdayStr}T13:00:00`, end_time: `${yesterdayStr}T14:00:00`, raw_text: '午休', activity: '午休', category: '休息', details: '', mood: '', social: '', location: '宿舍' },
    { created_at: `${yesterdayStr}T17:10:00`, start_time: `${yesterdayStr}T14:00:00`, end_time: `${yesterdayStr}T17:00:00`, raw_text: '复习考试', activity: '复习', category: '学习', details: '复习高数', mood: '紧张', social: '', location: '图书馆' },
    { created_at: `${yesterdayStr}T19:10:00`, start_time: `${yesterdayStr}T18:00:00`, end_time: `${yesterdayStr}T19:00:00`, raw_text: '和朋友打羽毛球', activity: '羽毛球', category: '运动', details: '', mood: '开心', social: '朋友', location: '体育馆' },
    { created_at: `${yesterdayStr}T22:10:00`, start_time: `${yesterdayStr}T20:00:00`, end_time: `${yesterdayStr}T22:00:00`, raw_text: '看电影', activity: '看电影', category: '娱乐', details: '看了个科幻片', mood: '', social: '室友', location: '宿舍' },
    // Day before yesterday
    { created_at: `${dayBeforeStr}T09:10:00`, start_time: `${dayBeforeStr}T08:00:00`, end_time: `${dayBeforeStr}T09:00:00`, raw_text: '超市买东西', activity: '购物', category: '购物', details: '买了零食和日用品', mood: '', social: '', location: '超市' },
    { created_at: `${dayBeforeStr}T12:10:00`, start_time: `${dayBeforeStr}T10:00:00`, end_time: `${dayBeforeStr}T12:00:00`, raw_text: '做实验', activity: '实验', category: '学习', details: '物理实验', mood: '', social: '同学', location: '实验室' },
    { created_at: `${dayBeforeStr}T15:10:00`, start_time: `${dayBeforeStr}T14:00:00`, end_time: `${dayBeforeStr}T15:00:00`, raw_text: '打扫宿舍', activity: '打扫', category: '家务', details: '拖地擦桌子', mood: '累', social: '室友', location: '宿舍' },
  ];

  for (const d of seedData) {
    const id = generateId();
    await database.runAsync(
      `INSERT INTO records (id, created_at, start_time, end_time, raw_text, activity, category, details, mood, social, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.created_at, d.start_time, d.end_time, d.raw_text, d.activity, d.category, d.details, d.mood, d.social, d.location]
    );
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
  return await database.getAllAsync<Record>(
    'SELECT * FROM records WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC',
    [start, end]
  );
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
  return await database.getAllAsync<Record>(
    'SELECT * FROM records WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC',
    [start, end]
  );
}

export async function deleteRecord(id: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM records WHERE id = ?', [id]);
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
