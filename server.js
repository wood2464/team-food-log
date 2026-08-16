import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 环境变量在各平台的网页表单里粘贴时，经常会不小心带上首尾空格/换行，
// 这类字符混进 HTTP header（比如 Turso 的 Bearer token）会直接导致请求报错，
// 所以统一 trim 一遍，防止这种复制粘贴的小问题搞垮整个服务。
const TURSO_URL = process.env.TURSO_URL?.trim() || 'file:db.sqlite';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;

// 数据库连接
const db = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN,
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 初始化数据库
async function initDB() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rating INTEGER DEFAULT 0,
        currency TEXT DEFAULT '¥',
        price REAL,
        cuisine TEXT,
        address TEXT,
        notes TEXT,
        photos TEXT,
        dishes TEXT,
        links TEXT,
        addedBy TEXT,
        createdAt INTEGER,
        updatedAt INTEGER
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    console.log('Database initialized');
  } catch (e) {
    console.error('DB init error:', e.message);
    process.exit(1);
  }
}

// ============ 数据库 API ============

// 获取所有餐厅
app.get('/api/restaurants', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM restaurants ORDER BY createdAt DESC');
    const restaurants = (result.rows || []).map(row => ({
      id: row.id,
      name: row.name,
      rating: row.rating,
      currency: row.currency,
      price: row.price,
      cuisine: row.cuisine ? JSON.parse(row.cuisine) : [],
      address: row.address,
      notes: row.notes,
      photos: row.photos ? JSON.parse(row.photos) : [],
      dishes: row.dishes ? JSON.parse(row.dishes) : [],
      links: row.links ? JSON.parse(row.links) : [],
      addedBy: row.addedBy,
      createdAt: row.createdAt,
    }));
    res.json(restaurants);
  } catch (e) {
    console.error('Get restaurants error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 保存餐厅
app.post('/api/restaurants', async (req, res) => {
  try {
    const r = req.body;
    await db.execute({
      sql: `INSERT OR REPLACE INTO restaurants
       (id, name, rating, currency, price, cuisine, address, notes, photos, dishes, links, addedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.id, r.name, r.rating, r.currency, r.price,
        JSON.stringify(r.cuisine || []), r.address, r.notes,
        JSON.stringify(r.photos || []), JSON.stringify(r.dishes || []),
        JSON.stringify(r.links || []), r.addedBy, r.createdAt, Date.now(),
      ],
    });
    res.json({ success: true, id: r.id });
  } catch (e) {
    console.error('Save restaurant error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 删除餐厅
app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM restaurants WHERE id = ?', args: [req.params.id] });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取/设置元数据（城市、标题等）
app.get('/api/meta', async (req, res) => {
  try {
    const result = await db.execute('SELECT key, value FROM metadata');
    const meta = {};
    for (const row of result.rows || []) meta[row.key] = row.value;
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meta/:key', async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT value FROM metadata WHERE key = ?', args: [req.params.key] });
    const value = result.rows?.[0]?.value || null;
    res.json({ value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/meta', async (req, res) => {
  try {
    const { key, value } = req.body;
    await db.execute({ sql: 'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', args: [key, value] });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 静态文件 & SPA ============

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

await initDB();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});