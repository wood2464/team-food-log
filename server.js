import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 数据库连接
const db = createClient({
  url: process.env.TURSO_URL || 'file:db.sqlite',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// Claude API 客户端（用于 /api/discover）
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';

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

// ============ Claude API 代理 (搜新店) ============

async function discoverRestaurants(city, cuisine, note) {
  const want = `在${city}${cuisine ? `的${cuisine}` : "的"}餐厅`;
  const prompt =
    `联网搜索${want}，${note ? `偏好：${note}，` : ""}找 6 家真实存在、目前正在营业、口碑不错的店。
请使用联网搜索工具核实这些餐厅确实存在（例如通过大众点评、美团、小红书等信息源核实），不要编造不存在的餐厅。
只返回一个 JSON 数组，不要任何解释、前后缀或 markdown 代码块。每个对象字段：
name(店名), area(所在商圈或区), cuisine(菜系), price(人均消费数字,人民币,不确定填null), highlight(不超过20字的一句话亮点)。
示例：[{"name":"楠火锅","area":"福田","cuisine":"火锅","price":130,"highlight":"网红川锅，晚上常排队"}]`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    output_config: { effort: 'medium' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('搜索请求被拒绝，换个城市或菜系试试');
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = clean.indexOf('[');
  const e = clean.lastIndexOf(']');

  if (s === -1 || e === -1) throw new Error('没有搜到有效结果，请重试');

  const arr = JSON.parse(clean.slice(s, e + 1));
  return Array.isArray(arr) ? arr.slice(0, 8) : [];
}

app.post('/api/discover', async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(400).json({ error: '未配置 Claude API 密钥' });
    }
    const { city, cuisine, note } = req.body;
    if (!city || !String(city).trim()) {
      return res.status(400).json({ error: '请填写城市' });
    }
    const results = await discoverRestaurants(city, cuisine, note);
    res.json({ results });
  } catch (e) {
    console.error('Discover error:', e);
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
  if (!anthropic) {
    console.warn('ANTHROPIC_API_KEY 未配置，"搜新店发现" 功能将不可用');
  }
});