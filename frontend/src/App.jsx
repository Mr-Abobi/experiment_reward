import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API = '/api';

// Кастомная скрепка вместо нативного input[type=file]
function AttachButton({ accept, onChange, title = 'Прикрепить файл' }) {
  const ref = useRef(null);
  return (
    <>
      <button
        type="button"
        className="attach-btn"
        title={title}
        onClick={() => ref.current?.click()}
      >
        📎
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={onChange}
      />
    </>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [screen, setScreen] = useState('feed'); // feed | messages | awards | auth
  const [authMode, setAuthMode] = useState('login'); // login | register

  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [frames, setFrames] = useState([]);
  const [userFrames, setUserFrames] = useState({});

  // Auth forms
  const [loginName, setLoginName] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Post modal
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
  const [frameName, setFrameName] = useState('');
  const [frameCaption, setFrameCaption] = useState('');
  const [frameImg, setFrameImg] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [newOptionTitle, setNewOptionTitle] = useState('');
  const [editingFrameId, setEditingFrameId] = useState(null);

  // Awards / voting
  const [frameOptions, setFrameOptions] = useState({});
  const [votingEnds, setVotingEnds] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');

  const loadAll = async () => {
    const [p, u, f] = await Promise.all([
      axios.get(`${API}/posts`),
      axios.get(`${API}/users`),
      axios.get(`${API}/frames`),
    ]);
    setPosts(p.data);
    setUsers(u.data);
    setFrames(f.data);

    const map = {};
    for (const u2 of u.data) {
      const r = await axios.get(`${API}/users/${u2.id}/frames`);
      map[u2.id] = r.data;
    }
    setUserFrames(map);

    const optMap = {};
    for (const fr of f.data) {
      const o = await axios.get(`${API}/frames/${fr.id}/options`);
      optMap[fr.id] = o.data;
    }
    setFrameOptions(optMap);

    try {
      const s = await axios.get(`${API}/settings/voting-ends`);
      setVotingEnds(s.data.endsAt);
    } catch { /* эндпоинта может не быть, если бэк не обновлён */ }
  };

  useEffect(() => { loadAll(); }, []);

  // Таймер
  useEffect(() => {
    if (!votingEnds) return;
    const tick = () => {
      const diff = new Date(votingEnds) - new Date();
      if (diff <= 0) { setTimeLeft('Голосование закрыто'); return; }
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
      const r = await axios.post(`${API}/login`, { username: loginName, password: loginPass });
      setMe(r.data);
      setScreen('feed');
      setLoginName(''); setLoginPass('');
    } catch {
      alert('Неверный логин или пароль');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.post(`${API}/register`, { username: loginName, password: loginPass });
      setMe(r.data);
      setScreen('feed');
      setLoginName(''); setLoginPass('');
    } catch {
      alert('Имя занято или ошибка');
    }
  };

  const createPost = async (e) => {
    e.preventDefault();
    if (!me) return;
    const form = new FormData();
    form.append('userId', me.id);
    form.append('content', postContent);
    if (postFile) form.append('media', postFile);
    await axios.post(`${API}/posts`, form);
    setPostContent(''); setPostFile(null); setShowPostModal(false);
    loadAll();
  };

  const openChat = async (otherId) => {
    setChatWith(otherId);
    const r = await axios.get(`${API}/messages/${me.id}/${otherId}`);
    setChat(r.data);
    setScreen('messages');
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatWith) return;
    const form = new FormData();
    form.append('senderId', me.id);
    form.append('receiverId', chatWith);
    form.append('text', msgText);
    if (msgFile) form.append('media', msgFile);
    await axios.post(`${API}/messages`, form);
    setMsgText(''); setMsgFile(null);
    const r = await axios.get(`${API}/messages/${me.id}/${chatWith}`);
    setChat(r.data);
  };

  const createFrame = async (e) => {
    e.preventDefault();
    if (!me?.is_admin) return;
    const form = new FormData();
    form.append('name', frameName);
    form.append('caption', frameCaption);
    form.append('adminId', me.id);
    if (frameImg) form.append('image', frameImg);
    await axios.post(`${API}/frames`, form);
    setFrameName(''); setFrameCaption(''); setFrameImg(null);
    loadAll();
  };

  const assignFrame = async (frameId, userId) => {
    await axios.post(`${API}/frames/${frameId}/assign/${userId}`);
    loadAll();
  };

  const filteredUsers = users.filter(u =>
    u.id !== me?.id &&
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---------- Экран авторизации ----------
  if (!me && screen === 'auth') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="logo">Эксперемент Reward</h1>
          <p className="subtitle">премия, которую никто не просил</p>

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="auth-form">
              <h2>Вход</h2>
              <input placeholder="Логин" value={loginName} onChange={e => setLoginName(e.target.value)} />
              <input placeholder="Пароль" type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} />
              <button type="submit" className="btn-primary">Войти</button>
              <p className="switch">
                Нет аккаунта?{' '}
                <span onClick={() => setAuthMode('register')}>Зарегистрируйтесь</span>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <h2>Регистрация</h2>
              <input placeholder="Логин" value={loginName} onChange={e => setLoginName(e.target.value)} />
              <input placeholder="Пароль" type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} />
              <button type="submit" className="btn-primary">Создать аккаунт</button>
              <p className="switch">
                Уже есть аккаунт?{' '}
                <span onClick={() => setAuthMode('login')}>Войдите</span>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ---------- Основное приложение ----------
  return (
    <div className="app">
      {/* Левый сайдбар */}
      <aside className="sidebar">
        <button className="logo-btn" onClick={() => setScreen('awards')}>
          Эксперемент <span>Reward</span>
        </button>
        <nav>
          <button className={screen === 'feed' ? 'active' : ''} onClick={() => setScreen('feed')}>
            📰 Лента
          </button>
          <button className={screen === 'messages' ? 'active' : ''} onClick={() => { if (me) setScreen('messages'); else setScreen('auth'); }}>
            💬 Мессенджер
          </button>
          <button className={screen === 'awards' ? 'active' : ''} onClick={() => setScreen('awards')}>
            🏆 Награды
          </button>
          {me?.is_admin && (
            <button onClick={() => setShowAdmin(!showAdmin)}>⚙️ Админка</button>
          )}
        </nav>
        <div className="sidebar-bottom">
          {me ? (
            <>
              <div className="me-info">Вы: <b>{me.username}</b> {me.is_admin && '👑'}</div>
              <button onClick={() => { setMe(null); setScreen('feed'); }}>Выйти</button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setScreen('auth')}>Войти</button>
          )}
        </div>
      </aside>

      {/* Центральная область */}
      <main className="main">
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

            {!me && (
              <div className="empty-state">
                <h3>Тут пока пусто</h3>
                <p>Войди или зарегистрируйся, чтобы постить и читать ленту.</p>
                <button className="btn-primary" onClick={() => setScreen('auth')}>Войти</button>
              </div>
            )}

            {me && posts.length === 0 && (
              <div className="empty-state">
                <h3>Постов ещё нет</h3>
                <p>Стань первым, кто запостит что-то в Эксперемент Reward.</p>
                <button className="btn-primary" onClick={() => setShowPostModal(true)}>
                  Создать пост
                </button>
              </div>
            )}

            {posts.map(p => (
              <article key={p.id} className="post">
                <div className="post-head">
                  <b>{p.username}</b>
                  <div className="frames">
                    {(userFrames[p.user_id] || []).map(f => (
                      <div key={f.id} className="frame-wrapper" title={f.caption}>
                        <img src={f.image_url} alt={f.name} className="frame-img" />
                      </div>
                    ))}
                  </div>
                </div>
                <p>{p.content}</p>
                {p.media_url && (
                  p.media_url.match(/\.(mp4|webm|mov)$/i)
                    ? <video src={p.media_url} controls className="post-media" />
                    : <img src={p.media_url} className="post-media" alt="" />
                )}
              </article>
            ))}
          </div>
        )}

        {screen === 'messages' && me && (
          <div className="messenger">
            <div className="msg-sidebar">
              <input
                placeholder="Поиск..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="search-input"
              />
              <div className="user-list">
                {filteredUsers.map(u => (
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
                    {chat.map(m => (
                      <div key={m.id} className={m.sender_id === me.id ? 'bubble mine' : 'bubble theirs'}>
                        {m.text}
                        {m.media_url && (
                          m.media_url.match(/\.(mp4|webm|mov)$/i)
                            ? <video src={m.media_url} controls className="chat-media" />
                            : <img src={m.media_url} className="chat-media" alt="" />
                        )}
                      </div>
                    ))}
                  </div>
                  <form onSubmit={sendMessage} className="chat-input">
                    <AttachButton
                      accept="image/*,video/*"
                      onChange={e => setMsgFile(e.target.files[0])}
                      title="Прикрепить картинку или видео"
                    />
                    <input
                      value={msgText}
                      onChange={e => setMsgText(e.target.value)}
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

        {screen === 'awards' && (
          <div className="awards-page">
            <div className="awards-header">
              <h2>🏆 Эксперемент Reward</h2>
              <div className="timer">До конца голосования: <b>{timeLeft || '...'}</b></div>
            </div>

            {frames.length === 0 && (
              <div className="empty-state">
                <h3>Наград пока нет</h3>
                <p>Админ ещё не создал ни одной рамки.</p>
              </div>
            )}

            {frames.map(f => (
              <div key={f.id} className="award-card">
                <div className="award-title">
                  <img src={f.image_url} alt="" className="award-img" />
                  <div>
                    <h3>{f.name}</h3>
                    <p className="muted">{f.caption}</p>
                  </div>
                </div>

                <details className="vote-dropdown">
                  <summary>Проголосовать за вариант</summary>
                  <div className="vote-options">
                    {(frameOptions[f.id] || []).map(o => (
                      <button
                        key={o.id}
                        className="vote-btn"
                        onClick={async () => {
                          if (!me) return alert('Войдите');
                          try {
                            await axios.post(`${API}/vote`, { userId: me.id, optionId: o.id });
                            alert('Голос учтён!');
                            loadAll();
                          } catch { alert('Вы уже голосовали'); }
                        }}
                      >
                        {o.title} — {o.votes} голосов
                      </button>
                    ))}
                    {(frameOptions[f.id] || []).length === 0 && <p className="muted">Нет вариантов</p>}
                  </div>
                </details>

                <div className="results">
                  {(frameOptions[f.id] || []).slice().sort((a, b) => b.votes - a.votes).slice(0, 3).map((o, i) => (
                    <div key={o.id} className="result-row">
                      <span>#{i + 1}</span>
                      <span>{o.title}</span>
                      <b>{o.votes}</b>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Модалка создания поста */}
      {showPostModal && (
        <div className="modal-overlay" onClick={() => setShowPostModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Создать пост</h2>
            <form onSubmit={createPost}>
              <textarea
                placeholder="Что нового в эксперементе?"
                value={postContent}
                onChange={e => setPostContent(e.target.value)}
                rows={5}
              />
              <div className="attach-row">
                <AttachButton
                  accept="image/*,video/*"
                  onChange={e => setPostFile(e.target.files[0])}
                  title="Прикрепить картинку или видео"
                />
                <span className="attach-hint">
                  {postFile ? postFile.name : 'картинка / gif / видео'}
                </span>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowPostModal(false)}>Отмена</button>
                <button type="submit" className="btn-primary">Опубликовать</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Админка */}
      {showAdmin && me?.is_admin && (
        <div className="admin-panel">
          <h3>Админка рамок</h3>
          <form onSubmit={createFrame} className="admin-form">
            <input placeholder="Название" value={frameName} onChange={e => setFrameName(e.target.value)} />
            <input placeholder="Подпись" value={frameCaption} onChange={e => setFrameCaption(e.target.value)} />
            <AttachButton accept="image/*" onChange={e => setFrameImg(e.target.files[0])} title="Картинка рамки" />
            <span className="attach-hint">{frameImg ? frameImg.name : 'картинка'}</span>
            <button type="submit">Создать рамку</button>
          </form>

          <h4>Рамки и варианты</h4>
          {frames.map(f => (
            <div key={f.id} className="admin-frame-block">
              <div className="frame-admin-row">
                <img src={f.image_url} className="frame-img" alt="" />
                <span>{f.name}</span>
                <button onClick={async () => {
                  await axios.post(`${API}/frames/${f.id}/duplicate`, { adminId: me.id });
                  loadAll();
                }}>Дублировать</button>
              </div>
              {(frameOptions[f.id] || []).map(o => (
                <div key={o.id} className="option-row">
                  <span>{o.title} <span className="muted">({o.votes})</span></span>
                  <button onClick={async () => {
                    await axios.delete(`${API}/options/${o.id}?adminId=${me.id}`);
                    loadAll();
                  }}>✕</button>
                </div>
              ))}
              <div className="add-option">
                <input
                  placeholder="Новый вариант"
                  value={editingFrameId === f.id ? newOptionTitle : ''}
                  onChange={e => { setEditingFrameId(f.id); setNewOptionTitle(e.target.value); }}
                />
                <button onClick={async () => {
                  if (!newOptionTitle.trim()) return;
                  await axios.post(`${API}/frames/${f.id}/options`, {
                    title: newOptionTitle, adminId: me.id
                  });
                  setNewOptionTitle(''); setEditingFrameId(null);
                  loadAll();
                }}>+</button>
              </div>
            </div>
          ))}

          <h4>Выдать рамку пользователю</h4>
          {frames.map(f => (
            <div key={`assign-${f.id}`} className="frame-admin-row">
              <img src={f.image_url} className="frame-img" alt="" />
              <span>{f.name}</span>
              <select onChange={e => e.target.value && assignFrame(f.id, e.target.value)} defaultValue="">
                <option value="">→ юзер</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </div>
          ))}

          <h4>Таймер окончания голосования</h4>
          <input
            type="datetime-local"
            defaultValue={votingEnds ? votingEnds.slice(0, 16) : ''}
            onChange={async e => {
              await axios.post(`${API}/settings/voting-ends`, {
                adminId: me.id, endsAt: e.target.value
              });
              loadAll();
            }}
          />
        </div>
      )}
    </div>
  );
}