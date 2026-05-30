import React, { useState, useEffect, useRef } from 'react'
import { get, post, patch, getToken } from '../lib/api'
import useStore from '../store/useStore'
import Avatar from './Avatar'
import styles from './UserProfileModal.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

function fullUrl(url) {
  if (!url) return ''
  return url.startsWith('http') ? url : BASE_URL + url
}

function isVideo(url) {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  return ['mp4', 'webm', 'ogg', 'mov'].includes(ext)
}

function BannerMedia({ url, color }) {
  if (url) {
    const src = fullUrl(url)
    if (isVideo(src)) {
      return <video className={styles.bannerMedia} src={src} autoPlay loop muted playsInline />
    }
    return <img className={styles.bannerMedia} src={src} alt="banner" />
  }
  return (
    <div
      className={styles.bannerFallback}
      style={color
        ? { background: color }
        : { background: 'linear-gradient(135deg, var(--accent) 0%, var(--acc3, #4c1d95) 100%)' }
      }
    />
  )
}

export default function UserProfileModal({ userId, username, onClose }) {
  const { me, conversations, setActiveConv, setView, updateMe } = useStore()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('about')
  const [editBanner, setEditBanner] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [colorInput, setColorInput] = useState('#7c3aed')
  const bannerFileRef = useRef(null)

  const isMe = user?.id === me?.id

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
      if (res?.ok) {
        setUser(res.data)
        setColorInput(res.data.bannerColor || '#7c3aed')
      }
      setLoading(false)
    }
    load()
  }, [userId, username])

  async function startChat() {
    if (!user) return
    const existing = conversations.find(c => c.otherUser?.id === user.id)
    if (existing) { setActiveConv(existing.id); setView('chats'); onClose(); return }
    const res = await post('/api/conversations', { json: { targetUserId: user.id } })
    if (res.ok) {
      const conv = res.data.conversation || res.data
      setActiveConv(conv.id); setView('chats'); onClose()
    }
  }

  async function uploadBannerFile(file) {
    if (!file) return
    setUploadingBanner(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(BASE_URL + '/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
        body: form,
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      const res = await patch('/api/users/me', { json: { banner: data.url } })
      if (res.ok) { setUser(u => ({ ...u, banner: data.url })); updateMe({ banner: data.url }) }
    } catch {}
    setUploadingBanner(false)
  }

  async function saveBannerColor() {
    const res = await patch('/api/users/me', { json: { bannerColor: colorInput || null } })
    if (res.ok) { setUser(u => ({ ...u, bannerColor: colorInput })); updateMe({ bannerColor: colorInput }) }
  }

  async function removeBanner() {
    const res = await patch('/api/users/me', { json: { banner: null } })
    if (res.ok) { setUser(u => ({ ...u, banner: null })); updateMe({ banner: null }) }
  }

  const avatarUrl = user?.avatar ? fullUrl(user.avatar) : null

  const nameStyle = user?.nicknameRainbow
    ? { backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', fontFamily: user.nicknameFont || undefined }
    : { color: user?.nicknameColor || undefined, fontFamily: user?.nicknameFont || undefined }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : !user ? (
          <div className={styles.loadingWrap}>Пользователь не найден</div>
        ) : (
          <>
            {/* ─── Banner ─── */}
            <div className={styles.bannerWrap}>
              <BannerMedia url={user.banner} color={user.bannerColor} />
              {isMe && (
                <button
                  className={styles.editBannerBtn}
                  onClick={() => setEditBanner(v => !v)}
                  title="Изменить баннер"
                >
                  ✏️
                </button>
              )}
            </div>

            {/* ─── Avatar + action row ─── */}
            <div className={styles.avatarRow}>
              <div className={styles.avatarWrap}>
                <Avatar name={user.displayName || user.username} size={88} src={avatarUrl} />
                {user.isPremium && <span className={styles.premiumRing} />}
                <div className={styles.statusDot} />
              </div>
              {!isMe && (
                <div className={styles.actionBtns}>
                  <button className={styles.primaryBtn} onClick={startChat}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                    Написать
                  </button>
                </div>
              )}
            </div>

            {/* ─── Banner edit panel ─── */}
            {isMe && editBanner && (
              <div className={styles.bannerEditPanel}>
                <p className={styles.bannerEditTitle}>Баннер профиля</p>
                <div className={styles.bannerEditRow}>
                  <button
                    className={styles.bannerUploadBtn}
                    onClick={() => bannerFileRef.current?.click()}
                    disabled={uploadingBanner}
                  >
                    {uploadingBanner ? 'Загружаю...' : '📁 Фото / GIF / Видео'}
                  </button>
                  {user.banner && (
                    <button className={styles.bannerRemoveBtn} onClick={removeBanner}>✕ Удалить</button>
                  )}
                </div>
                <div className={styles.bannerColorRow}>
                  <span className={styles.bannerColorLabel}>Цвет фона:</span>
                  <input type="color" className={styles.colorPicker} value={colorInput} onChange={e => setColorInput(e.target.value)} />
                  <button className={styles.colorSaveBtn} onClick={saveBannerColor}>Сохранить</button>
                </div>
                <input ref={bannerFileRef} type="file" accept="image/*,video/*,.gif" style={{ display: 'none' }} onChange={e => uploadBannerFile(e.target.files[0])} />
              </div>
            )}

            {/* ─── Name & badges ─── */}
            <div className={styles.nameBlock}>
              <div className={styles.nameRow}>
                <span className={styles.displayName} style={nameStyle}>
                  {user.displayName || user.username}
                </span>
                {user.isPremium && (
                  <span className={styles.premiumBadge}>⭐ Premium</span>
                )}
              </div>
              <span className={styles.usernameTag}>@{user.username}</span>
              {user.globalRole && user.globalRole !== 'user' && (
                <span className={styles.roleBadge} style={{
                  background:
                    user.globalRole === 'creator' ? 'linear-gradient(90deg,#4c1d95,#7c3aed)'
                    : user.globalRole === 'curator' ? 'linear-gradient(90deg,#0c4a6e,#0369a1)'
                    : 'linear-gradient(90deg,#92400e,#d97706)'
                }}>
                  {user.globalRole.charAt(0).toUpperCase() + user.globalRole.slice(1)}
                </span>
              )}
            </div>

            {/* ─── Divider ─── */}
            <div className={styles.divider} />

            {/* ─── Tabs ─── */}
            <div className={styles.tabs}>
              {['about', 'badges'].map(t => (
                <button
                  key={t}
                  className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t === 'about' ? 'О себе' : 'Значки'}
                </button>
              ))}
            </div>

            {/* ─── Tab body ─── */}
            <div className={styles.tabBody}>
              {tab === 'about' && (
                <>
                  {user.bio ? (
                    <div className={styles.section}>
                      <div className={styles.sectionLabel}>О СЕБЕ</div>
                      <p className={styles.bioText}>{user.bio}</p>
                    </div>
                  ) : (
                    <p className={styles.emptyText}>Нет информации о пользователе</p>
                  )}
                  <div className={styles.section}>
                    <div className={styles.sectionLabel}>НА OMNI С</div>
                    <p className={styles.memberSince}>
                      {new Date(user.createdAt).toLocaleDateString('ru', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                </>
              )}
              {tab === 'badges' && (
                <div className={styles.badgesGrid}>
                  {user.isPremium && (
                    <div className={styles.badgeItem} title="Premium">
                      <span className={styles.badgeIcon}>⭐</span>
                      <span className={styles.badgeLabel}>Premium</span>
                    </div>
                  )}
                  {user.isAdmin && (
                    <div className={styles.badgeItem} title="Администратор">
                      <span className={styles.badgeIcon}>🛡️</span>
                      <span className={styles.badgeLabel}>Админ</span>
                    </div>
                  )}
                  {user.globalRole === 'creator' && (
                    <div className={styles.badgeItem} title="Creator">
                      <span className={styles.badgeIcon}>👑</span>
                      <span className={styles.badgeLabel}>Creator</span>
                    </div>
                  )}
                  {user.globalRole === 'owner' && (
                    <div className={styles.badgeItem} title="Owner">
                      <span className={styles.badgeIcon}>💎</span>
                      <span className={styles.badgeLabel}>Owner</span>
                    </div>
                  )}
                  {!user.isPremium && !user.isAdmin && user.globalRole === 'user' && (
                    <p className={styles.emptyText}>Значков пока нет</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
