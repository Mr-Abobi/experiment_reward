const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB — для видео
  fileFilter: (req, file, cb) => {
    const ok = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
    ];
    ok.includes(file.mimetype) ? cb(null, true) : cb(new Error('only images/videos'));
  },
});

// ---------- AUTH ----------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1,$2) RETURNING id, username, is_admin',
      [username, password]
    );
    res.json(r.rows[0]);
  } catch {
    res.status(400).json({ error: 'username busy' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query(
    'SELECT id, username, is_admin FROM users WHERE username=$1 AND password=$2',
    [username, password]
  );
  if (!r.rows.length) return res.status(401).json({ error: 'bad creds' });
  res.json(r.rows[0]);
});

// ---------- POSTS ----------
app.post('/api/posts', upload.single('media'), async (req, res) => {
  const { userId, content } = req.body;
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const r = await pool.query(
    'INSERT INTO posts (user_id, content, media_url) VALUES ($1,$2,$3) RETURNING *',
    [userId, content, mediaUrl]
  );
  res.json(r.rows[0]);
});

app.get('/api/posts', async (req, res) => {
  const r = await pool.query(`
    SELECT p.*, u.username FROM posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 50
  `);
  res.json(r.rows);
});

// ---------- MESSAGES ----------
app.post('/api/messages', upload.single('media'), async (req, res) => {
  const { senderId, receiverId, text } = req.body;
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const r = await pool.query(
    'INSERT INTO messages (sender_id, receiver_id, text, media_url) VALUES ($1,$2,$3,$4) RETURNING *',
    [senderId, receiverId, text, mediaUrl]
  );
  res.json(r.rows[0]);
});

app.get('/api/messages/:a/:b', async (req, res) => {
  const { a, b } = req.params;
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
app.post('/api/frames', upload.single('image'), async (req, res) => {
  const { name, caption, adminId } = req.body;
  const adm = await pool.query('SELECT is_admin FROM users WHERE id=$1', [adminId]);
  if (!adm.rows[0]?.is_admin) return res.status(403).json({ error: 'no admin' });
  if (!req.file) return res.status(400).json({ error: 'image required' });

  const imageUrl = `/uploads/${req.file.filename}`;
  const r = await pool.query(
    'INSERT INTO frames (name, image_url, caption) VALUES ($1,$2,$3) RETURNING *',
    [name, imageUrl, caption]
  );
  res.json(r.rows[0]);
});

app.get('/api/frames', async (req, res) => {
  const r = await pool.query('SELECT * FROM frames ORDER BY id DESC');
  res.json(r.rows);
});

app.post('/api/frames/:frameId/assign/:userId', async (req, res) => {
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

// ---------- VOTING ----------
app.get('/api/frames/:frameId/options', async (req, res) => {
  const { frameId } = req.params;
  const r = await pool.query(
    'SELECT * FROM frame_options WHERE frame_id=$1 ORDER BY id',
    [frameId]
  );
  res.json(r.rows);
});

app.post('/api/frames/:frameId/options', async (req, res) => {
  const { frameId } = req.params;
  const { title, adminId } = req.body;
  const adm = await pool.query('SELECT is_admin FROM users WHERE id=$1', [adminId]);
  if (!adm.rows[0]?.is_admin) return res.status(403).json({ error: 'no admin' });
  const r = await pool.query(
    'INSERT INTO frame_options (frame_id, title) VALUES ($1,$2) RETURNING *',
    [frameId, title]
  );
  res.json(r.rows[0]);
});

app.delete('/api/options/:optionId', async (req, res) => {
  const { optionId } = req.params;
  const { adminId } = req.query;
  const adm = await pool.query('SELECT is_admin FROM users WHERE id=$1', [adminId]);
  if (!adm.rows[0]?.is_admin) return res.status(403).json({ error: 'no admin' });
  await pool.query('DELETE FROM frame_options WHERE id=$1', [optionId]);
  res.json({ ok: true });
});

app.post('/api/vote', async (req, res) => {
  const { userId, optionId } = req.body;
  try {
    await pool.query(
      'INSERT INTO votes (user_id, option_id) VALUES ($1,$2)',
      [userId, optionId]
    );
    await pool.query('UPDATE frame_options SET votes = votes + 1 WHERE id=$1', [optionId]);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'already voted' });
  }
});

app.get('/api/frames/:frameId/results', async (req, res) => {
  const { frameId } = req.params;
  const r = await pool.query(
    `SELECT fo.id, fo.title, fo.votes, uf.image_url, uf.name as frame_name
     FROM frame_options fo
     JOIN frames uf ON uf.id = fo.frame_id
     WHERE fo.frame_id=$1
     ORDER BY fo.votes DESC`,
    [frameId]
  );
  res.json(r.rows);
});

// Дублировать рамку со всеми вариантами
app.post('/api/frames/:frameId/duplicate', async (req, res) => {
  const { frameId } = req.params;
  const { adminId } = req.body;
  const adm = await pool.query('SELECT is_admin FROM users WHERE id=$1', [adminId]);
  if (!adm.rows[0]?.is_admin) return res.status(403).json({ error: 'no admin' });

  const orig = await pool.query('SELECT * FROM frames WHERE id=$1', [frameId]);
  if (!orig.rows.length) return res.status(404).json({ error: 'not found' });
  const f = orig.rows[0];

  const newFrame = await pool.query(
    `INSERT INTO frames (name, image_url, caption) VALUES ($1,$2,$3) RETURNING id`,
    [f.name + ' (копия)', f.image_url, f.caption]
  );
  const newId = newFrame.rows[0].id;

  await pool.query(
    `INSERT INTO frame_options (frame_id, title, votes)
     SELECT $1, title, 0 FROM frame_options WHERE frame_id=$2`,
    [newId, frameId]
  );

  res.json({ newFrameId: newId });
});

app.get('/api/settings/voting-ends', async (req, res) => {
  const r = await pool.query("SELECT value FROM settings WHERE key='voting_ends_at'");
  res.json({ endsAt: r.rows[0]?.value || null });
});

app.post('/api/settings/voting-ends', async (req, res) => {
  const { adminId, endsAt } = req.body;
  const adm = await pool.query('SELECT is_admin FROM users WHERE id=$1', [adminId]);
  if (!adm.rows[0]?.is_admin) return res.status(403).json({ error: 'no admin' });
  await pool.query(
    "UPDATE settings SET value=$1 WHERE key='voting_ends_at'",
    [endsAt]
  );
  res.json({ ok: true });
});

app.listen(3000, () => console.log('backend up'));