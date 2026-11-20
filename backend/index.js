const express = require('express');
const multer = require('multer');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const pool = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'experiment-reward-secret-change-me';

app.use(cors());
app.use(express.json({ limit: '10mb' })); // для base64 рисунков
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, fieldSize: 10 * 1024 * 1024 }, // fieldSize — для base64-рисунков
  fileFilter: (req, file, cb) => {
    const ok = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
    ];
    ok.includes(file.mimetype) ? cb(null, true) : cb(new Error('only images/videos'));
  },
});

// ---------- AUTH HELPERS ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'no token' });
  try {
    const token = header.replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'bad token' });
  }
}

// Токен необязателен: если он есть — знаем, кто смотрит (нужно для «моя реакция»)
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header) {
    try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); } catch { /* гость */ }
  }
  next();
}

// Обёртка для async-хендлеров: ошибка БД = 500, а не зависший запрос
const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  });

const isId = (v) => /^\d{1,9}$/.test(String(v));

const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

// Только ДОБАВЛЯЕТ таблицы (IF NOT EXISTS) — существующие данные не затрагиваются
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id);
    CREATE TABLE IF NOT EXISTS post_reactions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(16) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );
  `);
  console.log('schema ok');
}

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'no admin' });
  next();
}

// Не даём упасть процессу из-за необработанной ошибки в async-хендлере (Express 4)
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

// Админ создаётся/обновляется при КАЖДОМ старте, поэтому не зависит от init.sql
// (init.sql выполняется только на пустом томе pgdata).
async function ensureAdmin() {
  const name = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'admin';
  const hash = await bcrypt.hash(pass, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, is_admin) VALUES ($1,$2,TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_admin=TRUE`,
    [name, hash]
  );
  console.log(`admin "${name}" ready`);
}

// ---------- AUTH ----------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: 'bad data' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username, is_admin',
      [username, hash]
    );
    const user = r.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ ...user, token });
  } catch (e) {
    res.status(400).json({ error: 'username busy' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query(
    'SELECT id, username, password_hash, is_admin FROM users WHERE username=$1',
    [username]
  );
  if (!r.rows.length) return res.status(401).json({ error: 'bad creds' });

  const user = r.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'bad creds' });

  const token = jwt.sign(
    { id: user.id, username: user.username, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ id: user.id, username: user.username, is_admin: user.is_admin, token });
});

// ---------- POSTS ----------
app.post('/api/posts', authMiddleware, upload.single('media'), async (req, res) => {
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const r = await pool.query(
    'INSERT INTO posts (user_id, content, media_url) VALUES ($1,$2,$3) RETURNING *',
    [req.user.id, req.body.content || '', mediaUrl]
  );
  res.json(r.rows[0]);
});

const POST_SORTS = {
  new: 's.created_at DESC, s.id DESC',
  old: 's.created_at ASC, s.id ASC',
  popular: '(s.reactions_total + s.comments_count) DESC, s.created_at DESC, s.id DESC',
};

// ?sort=new (по умолчанию) | old | popular (реакции + комментарии)
app.get('/api/posts', optionalAuth, h(async (req, res) => {
  const order = POST_SORTS[req.query.sort] || POST_SORTS.new; // только из белого списка
  const r = await pool.query(`
    SELECT * FROM (
      SELECT p.*, u.username,
        (SELECT COUNT(*)::int FROM post_reactions pr WHERE pr.post_id = p.id) AS reactions_total,
        (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id) AS comments_count,
        (SELECT COALESCE(json_object_agg(t.emoji, t.n), '{}'::json) FROM (
           SELECT emoji, COUNT(*)::int AS n FROM post_reactions WHERE post_id = p.id GROUP BY emoji
         ) t) AS reactions,
        (SELECT emoji FROM post_reactions WHERE post_id = p.id AND user_id = $1::int) AS my_reaction
      FROM posts p
      JOIN users u ON u.id = p.user_id
    ) s
    ORDER BY ${order}
    LIMIT 200
  `, [req.user?.id || null]);
  res.json(r.rows);
}));

// ---------- REACTIONS ----------
// Одна реакция на пост от пользователя. Тот же эмодзи ещё раз — снять, другой — заменить.
app.put('/api/posts/:id/reaction', authMiddleware, h(async (req, res) => {
  const { id } = req.params;
  const { emoji } = req.body;
  if (!isId(id)) return res.status(400).json({ error: 'bad id' });
  if (emoji && !REACTIONS.includes(emoji)) return res.status(400).json({ error: 'bad emoji' });

  const post = await pool.query('SELECT 1 FROM posts WHERE id=$1', [id]);
  if (!post.rows.length) return res.status(404).json({ error: 'post not found' });

  const cur = await pool.query('SELECT emoji FROM post_reactions WHERE post_id=$1 AND user_id=$2', [id, req.user.id]);
  if (!emoji || cur.rows[0]?.emoji === emoji) {
    await pool.query('DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2', [id, req.user.id]);
  } else {
    await pool.query(
      `INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [id, req.user.id, emoji]
    );
  }

  const counts = await pool.query(
    'SELECT emoji, COUNT(*)::int AS n FROM post_reactions WHERE post_id=$1 GROUP BY emoji', [id]
  );
  const reactions = {};
  let total = 0;
  for (const row of counts.rows) { reactions[row.emoji] = row.n; total += row.n; }
  const mine = await pool.query('SELECT emoji FROM post_reactions WHERE post_id=$1 AND user_id=$2', [id, req.user.id]);
  res.json({ reactions, reactions_total: total, my_reaction: mine.rows[0]?.emoji || null });
}));

// ---------- COMMENTS ----------
app.get('/api/posts/:id/comments', h(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const r = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.username
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = $1 ORDER BY c.created_at ASC, c.id ASC LIMIT 500`,
    [req.params.id]
  );
  res.json(r.rows);
}));

app.post('/api/posts/:id/comments', authMiddleware, h(async (req, res) => {
  const { id } = req.params;
  const content = String(req.body.content || '').trim();
  if (!isId(id)) return res.status(400).json({ error: 'bad id' });
  if (!content || content.length > 1000) return res.status(400).json({ error: 'bad content' });

  const post = await pool.query('SELECT 1 FROM posts WHERE id=$1', [id]);
  if (!post.rows.length) return res.status(404).json({ error: 'post not found' });

  const ins = await pool.query(
    'INSERT INTO comments (post_id, user_id, content) VALUES ($1,$2,$3) RETURNING id',
    [id, req.user.id, content]
  );
  const r = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.username
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [ins.rows[0].id]
  );
  res.json(r.rows[0]);
}));

// Удалить может автор комментария или админ
app.delete('/api/comments/:id', authMiddleware, h(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const c = await pool.query('SELECT user_id FROM comments WHERE id=$1', [req.params.id]);
  if (!c.rows.length) return res.status(404).json({ error: 'not found' });
  if (c.rows[0].user_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await pool.query('DELETE FROM comments WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- MESSAGES ----------
app.post('/api/messages', authMiddleware, upload.single('media'), async (req, res) => {
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const r = await pool.query(
    'INSERT INTO messages (sender_id, receiver_id, text, media_url) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, req.body.receiverId, req.body.text || '', mediaUrl]
  );
  res.json(r.rows[0]);
});

app.get('/api/messages/:a/:b', authMiddleware, async (req, res) => {
  const { a, b } = req.params;
  // небольшой чек, что пользователь участвует в диалоге
  if (req.user.id != a && req.user.id != b) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const r = await pool.query(
    `SELECT * FROM messages
     WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
     ORDER BY created_at ASC`,
    [a, b]
  );
  res.json(r.rows);
});

// ---------- USERS ----------
app.get('/api/users', async (req, res) => {
  const r = await pool.query('SELECT id, username FROM users ORDER BY id');
  res.json(r.rows);
});

// ---------- FRAMES ----------
app.post('/api/frames', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  // Можно передать либо файл, либо base64 рисунок в body.imageBase64
  let imageUrl = null;

  if (req.file) {
    imageUrl = `/uploads/${req.file.filename}`;
  } else if (req.body.imageBase64) {
    const base64Data = req.body.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `${uuidv4()}.png`;
    const fs = require('fs');
    fs.writeFileSync(path.join('uploads', filename), buffer);
    imageUrl = `/uploads/${filename}`;
  }

  const r = await pool.query(
    'INSERT INTO frames (name, image_url, caption) VALUES ($1,$2,$3) RETURNING *',
    [req.body.name, imageUrl, req.body.caption || '']
  );
  res.json(r.rows[0]);
});

app.get('/api/frames', async (req, res) => {
  const r = await pool.query('SELECT * FROM frames ORDER BY id DESC');
  res.json(r.rows);
});

app.post('/api/frames/:frameId/assign/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  const { frameId, userId } = req.params;
  await pool.query(
    'INSERT INTO user_frames (user_id, frame_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [userId, frameId]
  );
  res.json({ ok: true });
});

app.get('/api/users/:userId/frames', async (req, res) => {
  const { userId } = req.params;
  const r = await pool.query(
    `SELECT f.* FROM frames f
     JOIN user_frames uf ON uf.frame_id = f.id
     WHERE uf.user_id = $1`,
    [userId]
  );
  res.json(r.rows);
});

// ---------- OPTIONS + VOTING ----------
app.get('/api/frames/:frameId/options', async (req, res) => {
  const { frameId } = req.params;
  const r = await pool.query(
    'SELECT * FROM frame_options WHERE frame_id=$1 ORDER BY id',
    [frameId]
  );
  res.json(r.rows);
});

app.post('/api/frames/:frameId/options', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  const { frameId } = req.params;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const r = await pool.query(
    'INSERT INTO frame_options (frame_id, title, image_url) VALUES ($1,$2,$3) RETURNING *',
    [frameId, req.body.title, imageUrl]
  );
  res.json(r.rows[0]);
});

// Обновить фото варианта
app.post('/api/options/:optionId/image', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no image' });
  const imageUrl = `/uploads/${req.file.filename}`;
  await pool.query('UPDATE frame_options SET image_url=$1 WHERE id=$2', [imageUrl, req.params.optionId]);
  res.json({ image_url: imageUrl });
});

app.delete('/api/options/:optionId', authMiddleware, adminMiddleware, async (req, res) => {
  await pool.query('DELETE FROM frame_options WHERE id=$1', [req.params.optionId]);
  res.json({ ok: true });
});

app.post('/api/vote', authMiddleware, async (req, res) => {
  const { optionId } = req.body;
  if (!optionId) return res.status(400).json({ error: 'no option' });

  // Получаем frame_id варианта
  const opt = await pool.query('SELECT frame_id FROM frame_options WHERE id=$1', [optionId]);
  if (!opt.rows.length) return res.status(404).json({ error: 'option not found' });
  const frameId = opt.rows[0].frame_id;

  // Проверяем, не голосовал ли уже
  const existing = await pool.query(
    'SELECT 1 FROM votes WHERE user_id=$1 AND frame_id=$2',
    [req.user.id, frameId]
  );
  if (existing.rows.length) {
    return res.status(400).json({ error: 'already voted for this frame' });
  }

  // Пишем голос + увеличиваем счётчик
  await pool.query(
    'INSERT INTO votes (user_id, frame_id, option_id) VALUES ($1,$2,$3)',
    [req.user.id, frameId, optionId]
  );
  await pool.query('UPDATE frame_options SET votes = votes + 1 WHERE id=$1', [optionId]);

  res.json({ ok: true });
});

app.get('/api/frames/:frameId/results', async (req, res) => {
  const { frameId } = req.params;
  const r = await pool.query(
    `SELECT fo.* FROM frame_options fo
     WHERE fo.frame_id=$1
     ORDER BY fo.votes DESC`,
    [frameId]
  );
  res.json(r.rows);
});

// Удалить номинацию целиком (варианты, голоса и выданные рамки удалятся каскадом)
app.delete('/api/frames/:frameId', authMiddleware, adminMiddleware, h(async (req, res) => {
  if (!isId(req.params.frameId)) return res.status(400).json({ error: 'bad id' });
  const r = await pool.query('DELETE FROM frames WHERE id=$1 RETURNING id', [req.params.frameId]);
  if (!r.rows.length) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// Дублировать рамку
app.post('/api/frames/:frameId/duplicate', authMiddleware, adminMiddleware, async (req, res) => {
  const { frameId } = req.params;
  const orig = await pool.query('SELECT * FROM frames WHERE id=$1', [frameId]);
  if (!orig.rows.length) return res.status(404).json({ error: 'not found' });
  const f = orig.rows[0];

  const newFrame = await pool.query(
    `INSERT INTO frames (name, image_url, caption) VALUES ($1,$2,$3) RETURNING id`,
    [f.name + ' (копия)', f.image_url, f.caption]
  );
  const newId = newFrame.rows[0].id;

  await pool.query(
    `INSERT INTO frame_options (frame_id, title, image_url, votes)
     SELECT $1, title, image_url, 0 FROM frame_options WHERE frame_id=$2`,
    [newId, frameId]
  );

  res.json({ newFrameId: newId });
});

// ---------- SETTINGS ----------
app.get('/api/settings/voting-ends', async (req, res) => {
  const r = await pool.query("SELECT value FROM settings WHERE key='voting_ends_at'");
  res.json({ endsAt: r.rows[0]?.value || null });
});

app.post('/api/settings/voting-ends', authMiddleware, adminMiddleware, async (req, res) => {
  await pool.query(
    "UPDATE settings SET value=$1 WHERE key='voting_ends_at'",
    [req.body.endsAt]
  );
  res.json({ ok: true });
});

// ---------- ME ----------
app.get('/api/me', authMiddleware, async (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, is_admin: req.user.is_admin });
});

(async () => {
  try { await ensureSchema(); } catch (e) { console.error('ensureSchema failed:', e.message); }
  try { await ensureAdmin(); } catch (e) { console.error('ensureAdmin failed (старая схема БД? сделай docker compose down -v):', e.message); }
  app.listen(3000, () => console.log('backend up on :3000'));
})();
