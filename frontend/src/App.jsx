import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

// axios с автоматической подстановкой токена
const api = axios.create({ baseURL: API });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function AttachButton({ accept, onChange, title = 'Прикрепить файл' }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className="attach-btn" title={title} onClick={() => ref.current?.click()}>
        📎
      </button>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={onChange} />
    </>
  );
}

// Полноэкранный просмотр картинки (как в ВК): клик по фону / Esc — закрыть
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Закрыть">✕</button>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <a className="lightbox-open" href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        Открыть оригинал
      </a>
    </div>
  );
}

// Простая рисовалка
function DrawingCanvas({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState('#c9a84c');
  const [size, setSize] = useState(4);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const start = (e) => {
    e.preventDefault();
    setDrawing(true);
    const pos = getPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stop = () => setDrawing(false);

  const clear = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const save = () => {
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div className="drawing-modal">
      <div className="drawing-toolbar">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input type="range" min="1" max="30" value={size} onChange={(e) => setSize(+e.target.value)} />
        <button type="button" onClick={clear}>Очистить</button>
        <button type="button" className="btn-primary" onClick={save}>Сохранить рисунок</button>
        <button type="button" onClick={onCancel}>Отмена</button>
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={400}
        className="drawing-canvas"
        onMouseDown={start}
        onMouseMove={draw}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={draw}
        onTouchEnd={stop}
      />
    </div>
  );
}

const REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

const SORTS = [
  { id: 'popular', label: '🔥 Популярные' },
  { id: 'new', label: '🆕 Новые' },
  { id: 'old', label: '🕰 Старые' },
];

function formatTime(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// Один пост: реакции + комментарии (комментарии подгружаются при открытии)
function PostCard({ post, me, frames, onZoom, onNeedAuth, onUpdate }) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadComments = async () => {
    try {
      const r = await api.get(`/posts/${post.id}/comments`);
      setComments(r.data);
    } catch {
      setComments([]);
    }
  };

  const toggleComments = () => {
    const next = !showComments;
    setShowComments(next);
    if (next && comments === null) loadComments();
  };

  const react = async (emoji) => {
    if (!me) return onNeedAuth();
    try {
      const r = await api.put(`/posts/${post.id}/reaction`, { emoji });
      onUpdate({ ...post, ...r.data });
    } catch {
      alert('Не удалось поставить реакцию');
    }
  };

  const sendComment = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await api.post(`/posts/${post.id}/comments`, { content: text });
      setComments((prev) => [...(prev || []), r.data]);
      onUpdate({ ...post, comments_count: post.comments_count + 1 });
      setDraft('');
    } catch {
      alert('Не удалось отправить комментарий');
    }
    setBusy(false);
  };

  const removeComment = async (c) => {
    if (!window.confirm('Удалить комментарий?')) return;
    try {
      await api.delete(`/comments/${c.id}`);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      onUpdate({ ...post, comments_count: Math.max(0, post.comments_count - 1) });
    } catch {
      alert('Не удалось удалить');
    }
  };

  return (
    <article className="post">
      <div className="post-head">
        <b>{post.username}</b>
        <div className="frames">
          {(frames || []).map((f) => (
            <div key={f.id} className="frame-wrapper" title={f.caption || f.name}>
              <img src={f.image_url} alt={f.name} className="frame-img" />
            </div>
          ))}
        </div>
      </div>
      <p>{post.content}</p>
      {post.media_url &&
        (post.media_url.match(/\.(mp4|webm|mov)$/i) ? (
          <video src={post.media_url} controls className="post-media" />
        ) : (
          <img src={post.media_url} className="post-media zoomable" alt="" onClick={() => onZoom(post.media_url)} />
        ))}

      <div className="post-actions">
        <div className="react-bar">
          {REACTIONS.map((emoji) => {
            const n = post.reactions?.[emoji] || 0;
            return (
              <button
                key={emoji}
                type="button"
                className={'react-btn' + (post.my_reaction === emoji ? ' active' : '')}
                onClick={() => react(emoji)}
                title={me ? '' : 'Войди, чтобы ставить реакции'}
              >
                {emoji}
                {n > 0 && <span>{n}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" className={'comments-toggle' + (showComments ? ' active' : '')} onClick={toggleComments}>
          💬 {post.comments_count > 0 ? post.comments_count : 'Комментировать'}
        </button>
      </div>

      {showComments && (
        <div className="comments">
          {comments === null && <div className="muted">Загрузка…</div>}
          {comments?.length === 0 && <div className="muted">Комментариев пока нет</div>}
          {comments?.map((c) => (
            <div key={c.id} className="comment">
              <div className="comment-head">
                <b>{c.username}</b>
                <span className="muted">{formatTime(c.created_at)}</span>
                {me && (me.id === c.user_id || me.is_admin) && (
                  <button type="button" className="comment-del" onClick={() => removeComment(c)} title="Удалить">✕</button>
                )}
              </div>
              <div className="comment-text">{c.content}</div>
            </div>
          ))}
          {me ? (
            <form className="comment-form" onSubmit={sendComment}>
              <input
                value={draft}
                maxLength={1000}
                placeholder="Написать комментарий…"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>→</button>
            </form>
          ) : (
            <div className="muted">
              <span className="link" onClick={onNeedAuth}>Войди</span>, чтобы комментировать
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [feedSort, setFeedSort] = useState('new'); // по умолчанию — сначала новые
  const sortRef = useRef('new');
  const [screen, setScreen] = useState('feed');
  const [authMode, setAuthMode] = useState('login');

  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [frames, setFrames] = useState([]);
  const [userFrames, setUserFrames] = useState({});
  const [frameOptions, setFrameOptions] = useState({});
  const [votingEnds, setVotingEnds] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [votingClosed, setVotingClosed] = useState(false);

  // Auth
  const [loginName, setLoginName] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Post
  const [showPostModal, setShowPostModal] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postFile, setPostFile] = useState(null);

  // Messenger
  const [chatWith, setChatWith] = useState(null);
  const [chat, setChat] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [msgFile, setMsgFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Admin
  const [showAdmin, setShowAdmin] = useState(false);
  const [frameName, setFrameName] = useState('');
  const [frameCaption, setFrameCaption] = useState('');
  const [frameImg, setFrameImg] = useState(null);
  const [frameDrawing, setFrameDrawing] = useState(null);
  const [showDrawing, setShowDrawing] = useState(false);
  const [newOptionTitle, setNewOptionTitle] = useState('');
  const [editingFrameId, setEditingFrameId] = useState(null);
  const [optionImageFiles, setOptionImageFiles] = useState({});

  const loadAll = useCallback(async () => {
    try {
      const [p, u, f] = await Promise.all([
        api.get('/posts', { params: { sort: sortRef.current } }),
        api.get('/users'),
        api.get('/frames'),
      ]);
      setPosts(p.data);
      setUsers(u.data);
      setFrames(f.data);

      const map = {};
      for (const u2 of u.data) {
        try {
          const r = await api.get(`/users/${u2.id}/frames`);
          map[u2.id] = r.data;
        } catch {}
      }
      setUserFrames(map);

      const optMap = {};
      for (const fr of f.data) {
        try {
          const o = await api.get(`/frames/${fr.id}/options`);
          optMap[fr.id] = o.data;
        } catch {}
      }
      setFrameOptions(optMap);

      try {
        const s = await api.get('/settings/voting-ends');
        setVotingEnds(s.data.endsAt);
      } catch {}
    } catch (e) {
      console.error('loadAll error', e);
    }
  }, []);

  // Восстановление сессии
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/me')
        .then((r) => {
          setMe(r.data);
          setScreen('feed');
        })
        .catch(() => {
          localStorage.removeItem('token');
        });
    }
    loadAll();
  }, [loadAll]);

  // Таймер
  useEffect(() => {
    if (!votingEnds) return;
    const tick = () => {
      const diff = new Date(votingEnds) - new Date();
      if (diff <= 0) {
        setTimeLeft('Голосование закрыто');
        setVotingClosed(true);
        return;
      }
      setVotingClosed(false);
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${d}д ${h}ч ${m}м ${s}с`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [votingEnds]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/login', { username: loginName, password: loginPass });
      localStorage.setItem('token', r.data.token);
      setMe(r.data);
      setScreen('feed');
      setLoginName('');
      setLoginPass('');
      loadAll();
    } catch {
      alert('Неверный логин или пароль');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/register', { username: loginName, password: loginPass });
      localStorage.setItem('token', r.data.token);
      setMe(r.data);
      setScreen('feed');
      setLoginName('');
      setLoginPass('');
      loadAll();
    } catch {
      alert('Имя занято или ошибка');
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setMe(null);
    setScreen('feed');
  };

  const createPost = async (e) => {
    e.preventDefault();
    if (!me) return;
    try {
      const form = new FormData();
      form.append('content', postContent);
      if (postFile) form.append('media', postFile);
      await api.post('/posts', form);
      setPostContent('');
      setPostFile(null);
      setShowPostModal(false);
      loadAll();
    } catch (err) {
      console.error(err);
      alert('Не удалось создать пост');
    }
  };

  const openChat = async (otherId) => {
    setChatWith(otherId);
    try {
      const r = await api.get(`/messages/${me.id}/${otherId}`);
      setChat(r.data);
    } catch {
      setChat([]);
    }
    setScreen('messages');
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatWith || !me) return;
    try {
      const form = new FormData();
      form.append('receiverId', chatWith);
      form.append('text', msgText);
      if (msgFile) form.append('media', msgFile);
      await api.post('/messages', form);
      setMsgText('');
      setMsgFile(null);
      const r = await api.get(`/messages/${me.id}/${chatWith}`);
      setChat(r.data);
    } catch (err) {
      console.error(err);
      alert('Не удалось отправить сообщение');
    }
  };

  const createFrame = async (e) => {
    e.preventDefault();
    if (!me?.is_admin) return;
    try {
      const form = new FormData();
      form.append('name', frameName);
      form.append('caption', frameCaption);
      if (frameImg) form.append('image', frameImg);
      if (frameDrawing) form.append('imageBase64', frameDrawing);

      await api.post('/frames', form);
      setFrameName('');
      setFrameCaption('');
      setFrameImg(null);
      setFrameDrawing(null);
      loadAll();
    } catch (err) {
      console.error(err);
      alert('Ошибка создания рамки');
    }
  };

  const assignFrame = async (frameId, userId) => {
    await api.post(`/frames/${frameId}/assign/${userId}`);
    loadAll();
  };

  const vote = async (optionId) => {
    if (!me) return alert('Войдите');
    try {
      await api.post('/vote', { optionId });
      alert('Голос учтён!');
      loadAll();
    } catch (err) {
      const msg = err.response?.data?.error || 'Ошибка';
      if (msg.includes('already')) alert('Вы уже голосовали в этой номинации');
      else alert(msg);
    }
  };

  const filteredUsers = users.filter(
    (u) => u.id !== me?.id && u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---------- AUTH SCREEN ----------
  if (!me && screen === 'auth') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="logo">Эксперемент Reward</h1>
          <p className="subtitle">премия, которую никто не просил</p>

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="auth-form">
              <h2>Вход</h2>
              <input placeholder="Логин" value={loginName} onChange={(e) => setLoginName(e.target.value)} required />
              <input placeholder="Пароль" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} required />
              <button type="submit" className="btn-primary">Войти</button>
              <p className="switch">
                Нет аккаунта? <span onClick={() => setAuthMode('register')}>Зарегистрируйтесь</span>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <h2>Регистрация</h2>
              <input placeholder="Логин" value={loginName} onChange={(e) => setLoginName(e.target.value)} required />
              <input placeholder="Пароль" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} required />
              <button type="submit" className="btn-primary">Создать аккаунт</button>
              <p className="switch">
                Уже есть аккаунт? <span onClick={() => setAuthMode('login')}>Войдите</span>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  const changeSort = async (id) => {
    if (id === sortRef.current) return;
    sortRef.current = id;
    setFeedSort(id);
    try {
      const r = await api.get('/posts', { params: { sort: id } });
      setPosts(r.data);
    } catch {
      /* оставляем текущую ленту */
    }
  };

  // ---------- MAIN ----------
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="logo-btn" onClick={() => setScreen('awards')}>
          Эксперемент <span>Reward</span>
        </button>
        <nav>
          <button className={screen === 'feed' ? 'active' : ''} onClick={() => setScreen('feed')}>
            📰 Лента
          </button>
          <button
            className={screen === 'messages' ? 'active' : ''}
            onClick={() => (me ? setScreen('messages') : setScreen('auth'))}
          >
            💬 Мессенджер
          </button>
          <button className={screen === 'awards' ? 'active' : ''} onClick={() => setScreen('awards')}>
            🏆 Награды
          </button>
          {me?.is_admin && (
            <button onClick={() => setShowAdmin(!showAdmin)}>⚙️ Админка</button>
          )}
        </nav>

        {!me && (
          <div className="promo-card">
            <div className="promo-emoji">🎭</div>
            <h4>Хочешь постить рофлянчики?</h4>
            <p>Зарегистрируйся: посты, реакции, комментарии и голосование за награды ждут тебя.</p>
            <button
              className="btn-primary"
              onClick={() => {
                setAuthMode('register');
                setScreen('auth');
              }}
            >
              Зарегистрироваться
            </button>
            <div className="promo-sub" onClick={() => { setAuthMode('login'); setScreen('auth'); }}>
              Уже есть аккаунт? Войти
            </div>
          </div>
        )}

        <div className="sidebar-bottom">
          {me ? (
            <>
              <div className="me-info">
                Вы: <b>{me.username}</b> {me.is_admin && '👑'}
              </div>
              <button onClick={logout}>Выйти</button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setScreen('auth')}>
              Войти
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {/* ===== FEED ===== */}
        {screen === 'feed' && (
          <div className="feed-wrap">
            <div className="feed-header">
              <h2>Лента</h2>
              {me && (
                <button className="btn-primary" onClick={() => setShowPostModal(true)}>
                  + Создать пост
                </button>
              )}
            </div>

            <div className="sort-bar">
              {SORTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={feedSort === o.id ? 'active' : ''}
                  onClick={() => changeSort(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {!me && (
              <div className="empty-state">
                <h3>Тут пока пусто</h3>
                <p>Войди, чтобы постить и читать ленту.</p>
                <button className="btn-primary" onClick={() => setScreen('auth')}>Войти</button>
              </div>
            )}

            {me && posts.length === 0 && (
              <div className="empty-state">
                <h3>Постов ещё нет</h3>
                <p>Стань первым.</p>
                <button className="btn-primary" onClick={() => setShowPostModal(true)}>Создать пост</button>
              </div>
            )}

            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                me={me}
                frames={userFrames[p.user_id]}
                onZoom={setLightboxSrc}
                onNeedAuth={() => setScreen('auth')}
                onUpdate={(np) => setPosts((ps) => ps.map((x) => (x.id === np.id ? np : x)))}
              />
            ))}
          </div>
        )}

        {/* ===== MESSENGER ===== */}
        {screen === 'messages' && me && (
          <div className="messenger">
            <div className="msg-sidebar">
              <input
                className="search-input"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="user-list">
                {filteredUsers.map((u) => (
                  <div
                    key={u.id}
                    className={`user-item ${chatWith === u.id ? 'active' : ''}`}
                    onClick={() => openChat(u.id)}
                  >
                    {u.username}
                  </div>
                ))}
                {filteredUsers.length === 0 && <p className="muted">Никого не нашли</p>}
              </div>
            </div>

            <div className="chat-area">
              {chatWith ? (
                <>
                  <div className="chat-body">
                    {chat.length === 0 && <p className="muted">Сообщений пока нет</p>}
                    {chat.map((m) => (
                      <div key={m.id} className={m.sender_id === me.id ? 'bubble mine' : 'bubble theirs'}>
                        {m.text}
                        {m.media_url &&
                          (m.media_url.match(/\.(mp4|webm|mov)$/i) ? (
                            <video src={m.media_url} controls className="chat-media" />
                          ) : (
                            <img src={m.media_url} className="chat-media zoomable" alt="" onClick={() => setLightboxSrc(m.media_url)} />
                          ))}
                      </div>
                    ))}
                  </div>
                  <form onSubmit={sendMessage} className="chat-input">
                    <AttachButton
                      accept="image/*,video/*"
                      onChange={(e) => setMsgFile(e.target.files[0])}
                    />
                    <input
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder="Сообщение..."
                    />
                    <button type="submit">➤</button>
                  </form>
                </>
              ) : (
                <div className="chat-empty">
                  <p className="muted">Выбери собеседника слева</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== AWARDS ===== */}
        {screen === 'awards' && (
          <div className="awards-page">
            <div className="awards-header">
              <h2>🏆 Эксперемент Reward</h2>
              <div className={`timer ${votingClosed ? 'closed' : ''}`}>
                {votingClosed ? 'Голосование закрыто' : `До конца: ${timeLeft || '...'}`}
              </div>
            </div>

            {frames.length === 0 && (
              <div className="empty-state">
                <h3>Наград пока нет</h3>
                <p>Админ ещё ничего не создал.</p>
              </div>
            )}

            {frames.map((f) => {
              const options = frameOptions[f.id] || [];
              const sorted = [...options].sort((a, b) => b.votes - a.votes);
              const winner = sorted[0];
              const showWinnerPhoto = votingClosed && winner;

              return (
                <div key={f.id} className="award-card">
                  <div className="award-title">
                    {showWinnerPhoto ? (
                      winner.image_url ? (
                        <img src={winner.image_url} alt="" className="award-img winner" />
                      ) : (
                        <div className="award-img placeholder">?</div>
                      )
                    ) : f.image_url ? (
                      <img src={f.image_url} alt="" className="award-img" />
                    ) : (
                      <div className="award-img placeholder">?</div>
                    )}
                    <div>
                      <h3>{f.name}</h3>
                      <p className="muted">{f.caption}</p>
                      {showWinnerPhoto && (
                        <p className="winner-label">Победитель: <b>{winner.title}</b></p>
                      )}
                    </div>
                  </div>

                  {!votingClosed && (
                    <div className="vote-section">
                      <h4>Голосовать:</h4>
                      <div className="vote-options">
                        {options.map((o) => (
                          <button key={o.id} className="vote-btn" onClick={() => vote(o.id)}>
                            {o.image_url && <img src={o.image_url} alt="" className="opt-thumb" />}
                            <span>{o.title}</span>
                            <b>{o.votes}</b>
                          </button>
                        ))}
                        {options.length === 0 && <p className="muted">Нет вариантов</p>}
                      </div>
                    </div>
                  )}

                  <div className="results">
                    <h4>Результаты</h4>
                    {sorted.slice(0, 5).map((o, i) => (
                      <div key={o.id} className="result-row">
                        <span className="place">#{i + 1}</span>
                        {o.image_url ? (
                          <img src={o.image_url} className="opt-thumb" alt="" />
                        ) : (
                          <div className="opt-thumb placeholder">?</div>
                        )}
                        <span className="title">{o.title}</span>
                        <b>{o.votes}</b>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {/* Post modal */}
      {showPostModal && (
        <div className="modal-overlay" onClick={() => setShowPostModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Создать пост</h2>
            <form onSubmit={createPost}>
              <textarea
                placeholder="Что нового в эксперементе?"
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                rows={5}
              />
              <div className="attach-row">
                <AttachButton accept="image/*,video/*" onChange={(e) => setPostFile(e.target.files[0])} />
                <span className="attach-hint">{postFile ? postFile.name : 'картинка / gif / видео'}</span>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowPostModal(false)}>Отмена</button>
                <button type="submit" className="btn-primary">Опубликовать</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Drawing modal */}
      {showDrawing && (
        <div className="modal-overlay">
          <div className="modal drawing-wrap" onClick={(e) => e.stopPropagation()}>
            <h2>Нарисовать рамку</h2>
            <DrawingCanvas
              onSave={(dataUrl) => {
                setFrameDrawing(dataUrl);
                setShowDrawing(false);
              }}
              onCancel={() => setShowDrawing(false)}
            />
          </div>
        </div>
      )}

      {/* Admin panel */}
      {showAdmin && me?.is_admin && (
        <div className="admin-panel">
          <h3>Админка рамок</h3>

          <form onSubmit={createFrame} className="admin-form">
            <input placeholder="Название" value={frameName} onChange={(e) => setFrameName(e.target.value)} required />
            <input placeholder="Подпись" value={frameCaption} onChange={(e) => setFrameCaption(e.target.value)} />
            <AttachButton accept="image/*" onChange={(e) => setFrameImg(e.target.files[0])} title="Загрузить картинку" />
            <button type="button" onClick={() => setShowDrawing(true)}>✏️ Нарисовать</button>
            {frameDrawing && <span className="attach-hint">Рисунок готов</span>}
            {frameImg && <span className="attach-hint">{frameImg.name}</span>}
            <button type="submit">Создать рамку</button>
          </form>

          <h4>Рамки и варианты</h4>
          {frames.map((f) => (
            <div key={f.id} className="admin-frame-block">
              <div className="frame-admin-row">
                {f.image_url ? <img src={f.image_url} className="frame-img" alt="" /> : <div className="frame-img placeholder">?</div>}
                <span>{f.name}</span>
                <button
                  onClick={async () => {
                    await api.post(`/frames/${f.id}/duplicate`);
                    loadAll();
                  }}
                >
                  Дублировать
                </button>
                <button
                  className="danger-btn"
                  onClick={async () => {
                    if (!window.confirm(`Удалить номинацию «${f.name}»?\nВместе с ней удалятся все варианты, голоса и выданные рамки.`)) return;
                    try {
                      await api.delete(`/frames/${f.id}`);
                      loadAll();
                    } catch {
                      alert('Не удалось удалить номинацию');
                    }
                  }}
                >
                  Удалить
                </button>
              </div>

              {(frameOptions[f.id] || []).map((o) => (
                <div key={o.id} className="option-row">
                  <div className="option-info">
                    {o.image_url ? <img src={o.image_url} className="opt-thumb" alt="" /> : <div className="opt-thumb placeholder">?</div>}
                    <span>{o.title} <span className="muted">({o.votes})</span></span>
                  </div>
                  <div className="option-actions">
                    <AttachButton
                      accept="image/*"
                      title="Фото участника"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const form = new FormData();
                        form.append('image', file);
                        await api.post(`/options/${o.id}/image`, form);
                        loadAll();
                      }}
                    />
                    <button
                      onClick={async () => {
                        await api.delete(`/options/${o.id}`);
                        loadAll();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              <div className="add-option">
                <input
                  placeholder="Новый вариант"
                  value={editingFrameId === f.id ? newOptionTitle : ''}
                  onChange={(e) => {
                    setEditingFrameId(f.id);
                    setNewOptionTitle(e.target.value);
                  }}
                />
                <button
                  onClick={async () => {
                    if (!newOptionTitle.trim()) return;
                    await api.post(`/frames/${f.id}/options`, { title: newOptionTitle });
                    setNewOptionTitle('');
                    setEditingFrameId(null);
                    loadAll();
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ))}

          <h4>Выдать рамку пользователю</h4>
          {frames.map((f) => (
            <div key={`assign-${f.id}`} className="frame-admin-row">
              {f.image_url ? <img src={f.image_url} className="frame-img" alt="" /> : null}
              <span>{f.name}</span>
              <select onChange={(e) => e.target.value && assignFrame(f.id, e.target.value)} defaultValue="">
                <option value="">→ юзер</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </div>
          ))}

          <h4>Таймер окончания голосования</h4>
          <input
            type="datetime-local"
            defaultValue={votingEnds ? votingEnds.slice(0, 16) : ''}
            onChange={async (e) => {
              await api.post('/settings/voting-ends', { endsAt: e.target.value });
              loadAll();
            }}
          />
        </div>
      )}
    </div>
  );
}