import React, { useState } from 'react'
import useStore from '../store/useStore'
import { get, post } from '../lib/api'
import Avatar from './Avatar'
import ServerBrowser from './server/ServerBrowser'
import NewChatModal from './chat/NewChatModal'
import styles from './Sidebar.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

const ROLE_COLORS = {
  creator: '#4c1d95',
  curator: '#0c4a6e',
  owner:   '#92400e',
}

export default function Sidebar({ getWs, onRefreshConvs, onRefreshServers }) {
  const { me, view, setView, conversations, activeConvId, setActiveConv,
    servers, activeServerId, setActiveServer, unread, wsConnected, logout } = useStore()
  const [search, setSearch] = useState('')
  const [showServerBrowser, setShowServerBrowser] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)

  const filteredConvs = conversations.filter(c => {
    const name = c.otherUser?.displayName || c.otherUser?.username || c.name || ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  const avatarUrl = me?.avatar ? (me.avatar.startsWith('http') ? me.avatar : BASE_URL + me.avatar) : null
  const roleColor = ROLE_COLORS[me?.globalRole]

  const displayNameStyle = me?.nicknameRainbow
    ? { backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: me.nicknameFont || undefined }
    : { color: me?.nicknameColor || undefined, fontFamily: me?.nicknameFont || undefined }

  function handleLogout() {
    useStore.getState().logout()
    localStorage.removeItem('omni_session')
    window.electron?.config.save({})
  }

  const isToolUser = me?.username === 'example'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.userBar}>
        <div className={styles.userInfo} onClick={() => setView('profile')}>
          <div className={styles.avatarWrap}>
            <Avatar name={me?.displayName || me?.username} size={34} src={avatarUrl} />
            <span className={`${styles.dot} ${wsConnected ? styles.dotGreen : styles.dotGray}`} />
          </div>
          <div className={styles.userName}>
            <div className={styles.nameRow}>
              <span className={styles.displayName} style={displayNameStyle}>
                {me?.displayName || me?.username}
              </span>
              {roleColor && (
                <span className={styles.roleIndicator} style={{ background: roleColor }} />
              )}
            </div>
            <span className={styles.statusText}>{wsConnected ? 'В сети' : 'Не в сети'}</span>
          </div>
        </div>
        <div className={styles.userActions}>
          {me?.isAdmin && (
            <button className={styles.iconBtn} onClick={() => setView('admin')} title="Админ-панель">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1l3 6 6 1-4.5 4.5 1 6L12 16l-5.5 2.5 1-6L3 8l6-1z"/>
              </svg>
            </button>
          )}
          {isToolUser && (
            <button
              className={styles.toolBtn}
              onClick={() => setView('tool')}
              title="Инструмент"
            >
              🔧 Инструмент
            </button>
          )}
          <button className={`${styles.iconBtn} ${view === 'creator' ? styles.iconBtnActive : ''}`} onClick={() => setView('creator')} title="Creator Studio">
            🎨
          </button>
          <button className={styles.iconBtn} onClick={() => setView('shop')} title="Магазин">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
          </button>
          <button
            className={`${styles.iconBtn} ${view === 'settings' ? styles.iconBtnActive : ''}`}
            onClick={() => setView('settings')}
            title="Настройки"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button className={styles.iconBtn} onClick={handleLogout} title="Выйти">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.navTabs}>
        <button className={`${styles.navTab} ${view === 'chats' ? styles.navTabActive : ''}`}
          onClick={() => setView('chats')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          Чаты
        </button>
        <button className={`${styles.navTab} ${view === 'servers' ? styles.navTabActive : ''}`}
          onClick={() => setView('servers')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          Серверы
        </button>
      </div>

      {view === 'chats' && (
        <>
          <div className={styles.searchRow}>
            <div className={styles.searchBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input className={styles.searchInput} placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className={styles.newChatBtn} onClick={() => setShowNewChat(true)} title="Новый чат">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          <div className={styles.list}>
            {filteredConvs.length === 0 && (
              <div className={styles.empty}>Нет разговоров</div>
            )}
            {filteredConvs.map(conv => (
              <ConvItem key={conv.id} conv={conv}
                active={activeConvId === conv.id}
                unread={unread[conv.id] || 0}
                onClick={() => { setActiveConv(conv.id); setView('chats') }}
              />
            ))}
          </div>
        </>
      )}

      {view === 'servers' && (
        <>
          <div className={styles.searchRow}>
            <button className={styles.fullBtn} onClick={() => setShowServerBrowser(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Найти сервер
            </button>
          </div>
          <div className={styles.list}>
            {servers.length === 0 && (
              <div className={styles.empty}>Нет серверов</div>
            )}
            {servers.map(s => (
              <ServerItem key={s.id} server={s}
                active={activeServerId === s.id}
                onClick={() => { setActiveServer(s.id); setView('servers') }}
              />
            ))}
          </div>
        </>
      )}

      {showServerBrowser && (
        <ServerBrowser onClose={() => { setShowServerBrowser(false); onRefreshServers() }} />
      )}
      {showNewChat && (
        <NewChatModal onClose={() => { setShowNewChat(false); onRefreshConvs() }} />
      )}
    </aside>
  )
}

function ConvItem({ conv, active, unread, onClick }) {
  const otherUserAvatarUrl = conv.otherUser?.avatar
    ? (conv.otherUser.avatar.startsWith('http') ? conv.otherUser.avatar : 'https://omnii.duckdns.org:3000' + conv.otherUser.avatar)
    : null
  const name = conv.otherUser?.displayName || conv.otherUser?.username || conv.name || 'Группа'
  const lastMsgContent = conv.lastMessage?.content || conv.lastMessage || ''
  const time = conv.lastMessageAt ? fmtTime(conv.lastMessageAt) : ''
  const isGroup = conv.isGroup

  return (
    <div className={`${styles.convItem} ${active ? styles.convActive : ''}`} onClick={onClick}>
      <div className={styles.convAvatar}>
        <Avatar name={name} size={38} src={otherUserAvatarUrl} />
        {isGroup && <span className={styles.groupBadge}>G</span>}
      </div>
      <div className={styles.convInfo}>
        <div className={styles.convTop}>
          <span className={styles.convName}>{name}</span>
          <span className={styles.convTime}>{time}</span>
        </div>
        <div className={styles.convBottom}>
          <span className={styles.convLast}>{typeof lastMsgContent === 'string' ? lastMsgContent : ''}</span>
          {unread > 0 && <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
        </div>
      </div>
    </div>
  )
}

function ServerItem({ server, active, onClick }) {
  return (
    <div className={`${styles.convItem} ${active ? styles.convActive : ''}`} onClick={onClick}>
      <div className={styles.serverIcon}>
        <Avatar name={server.name} size={38} />
      </div>
      <div className={styles.convInfo}>
        <div className={styles.convTop}>
          <span className={styles.convName}>{server.name}</span>
          {server.isPublic && <span className={styles.publicBadge}>публичный</span>}
        </div>
        <div className={styles.convBottom}>
          <span className={styles.convLast}>{server.memberCount} участников</span>
        </div>
      </div>
    </div>
  )
}

function fmtTime(ts) {
  try {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })
  } catch { return '' }
}
