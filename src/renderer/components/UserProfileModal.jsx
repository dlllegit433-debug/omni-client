import React, { useState, useEffect } from 'react'
import { get, post } from '../lib/api'
import useStore from '../store/useStore'
import Avatar from './Avatar'
import styles from './UserProfileModal.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

function fullUrl(url) {
  if (!url) return ''
  return url.startsWith('http') ? url : BASE_URL + url
}

export default function UserProfileModal({ userId, username, onClose, onStartChat }) {
  const { me, conversations, setActiveConv, setView } = useStore()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      let res
      if (userId) {
        res = await get(`/api/users/${userId}`)
      } else if (username) {
        res = await get('/api/users/search', { params: { username, multi: '1' } })
        if (res.ok) {
          const data = res.data
          const found = Array.isArray(data) ? data[0] : (data?.id ? data : null)
          if (found) res = { ok: true, data: found }
        }
      }
      if (res?.ok) setUser(res.data)
      setLoading(false)
    }
    load()
  }, [userId, username])

  async function startChat() {
    if (!user) return
    const existing = conversations.find(c => c.otherUser?.id === user.id)
    if (existing) {
      setActiveConv(existing.id)
      setView('chats')
      onClose()
      return
    }
    const res = await post('/api/conversations', { json: { targetUserId: user.id } })
    if (res.ok) {
      const conv = res.data.conversation || res.data
      setActiveConv(conv.id)
      setView('chats')
      onClose()
    }
  }

  const avatarUrl = user?.avatar ? fullUrl(user.avatar) : null
  const isMe = user?.id === me?.id

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        {loading ? (
          <div className={styles.loading}>Загрузка...</div>
        ) : !user ? (
          <div className={styles.loading}>Пользователь не найден</div>
        ) : (
          <>
            <div className={styles.header}>
              <div className={styles.avatarWrap}>
                <Avatar name={user.displayName || user.username} size={80} src={avatarUrl} />
                {user.isPremium && <span className={styles.premiumRing} />}
              </div>
            </div>

            <div className={styles.body}>
              <div className={styles.nameRow}>
                <span className={styles.displayName}
                  style={user.nicknameRainbow
                    ? { backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontFamily: user.nicknameFont || undefined }
                    : { color: user.nicknameColor || undefined, fontFamily: user.nicknameFont || undefined }
                  }>
                  {user.displayName || user.username}
                </span>
                {user.isPremium && <span className={styles.premiumBadge}>⭐ Premium</span>}
              </div>
              <span className={styles.username}>@{user.username}</span>

              {user.globalRole && (
                <span className={styles.roleBadge} style={{
                  background: user.globalRole === 'creator' ? '#4c1d95'
                    : user.globalRole === 'curator' ? '#0c4a6e' : '#92400e'
                }}>
                  {user.globalRole.charAt(0).toUpperCase() + user.globalRole.slice(1)}
                </span>
              )}

              {user.bio && <p className={styles.bio}>{user.bio}</p>}

              {!isMe && (
                <button className={styles.chatBtn} onClick={startChat}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                  </svg>
                  Написать
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
