import React, { useState, useRef } from 'react'
import useStore, { applyTheme } from '../store/useStore'
import { patch, post, getToken } from '../lib/api'
import Avatar from '../components/Avatar'
import styles from './ProfilePage.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

const THEMES = [
  { id: 'violet', label: 'Фиолет', color: '#7c3aed' },
  { id: 'blue',   label: 'Синий',  color: '#2563eb' },
  { id: 'green',  label: 'Зелёный',color: '#16a34a' },
  { id: 'red',    label: 'Красный',color: '#dc2626' },
  { id: 'orange', label: 'Оранжевый', color: '#ea580c' },
  { id: 'pink',   label: 'Розовый',color: '#db2777' },
  { id: 'cyan',   label: 'Голубой',color: '#0891b2' },
  { id: 'gold',   label: 'Золотой',color: '#d97706' },
]

const PREMIUM_FONTS = [
  { id: 'Inter, sans-serif',              label: 'Inter (стандартный)' },
  { id: '"Georgia", serif',               label: 'Georgia (классика)' },
  { id: '"Courier New", monospace',       label: 'Courier (код)' },
  { id: '"Times New Roman", serif',       label: 'Times New Roman' },
  { id: '"Arial Black", sans-serif',      label: 'Arial Black (жирный)' },
  { id: '"Comic Sans MS", cursive',       label: 'Comic Sans (весёлый)' },
  { id: '"Impact", sans-serif',           label: 'Impact (мощный)' },
  { id: '"Palatino Linotype", serif',     label: 'Palatino (элегантный)' },
]

const ROLE_INFO = {
  creator: { label: 'Creator', color: '#4c1d95' },
  curator: { label: 'Curator', color: '#0c4a6e' },
  owner:   { label: 'Owner',   color: '#92400e' },
}

export default function ProfilePage() {
  const { me, updateMe, theme, setTheme, addToast } = useStore()
  const [displayName, setDisplayName] = useState(me?.displayName || '')
  const [bio, setBio] = useState(me?.bio || '')
  const [promo, setPromo] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false)
  const [nicknameColor, setNicknameColor] = useState(me?.nicknameColor || '#ffffff')
  const [nicknameRainbow, setNicknameRainbow] = useState(me?.nicknameRainbow || false)
  const [nicknameFont, setNicknameFont] = useState(me?.nicknameFont || 'Inter, sans-serif')
  const [savingPremium, setSavingPremium] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [bannerColor, setBannerColor] = useState(me?.bannerColor || '#7c3aed')

  const avatarRef = useRef(null)
  const wallpaperRef = useRef(null)
  const bannerRef = useRef(null)

  const avatarUrl = me?.avatar ? (me.avatar.startsWith('http') ? me.avatar : BASE_URL + me.avatar) : null
  const wallpaperUrl = me?.wallpaper ? (me.wallpaper.startsWith('http') ? me.wallpaper : BASE_URL + me.wallpaper) : null
  const bannerUrl = me?.banner ? (me.banner.startsWith('http') ? me.banner : BASE_URL + me.banner) : null
  const roleInfo = ROLE_INFO[me?.globalRole]

  function isBannerVideo(url) {
    if (!url) return false
    const ext = url.split('?')[0].split('.').pop().toLowerCase()
    return ['mp4', 'webm', 'ogg', 'mov'].includes(ext)
  }

  async function uploadBanner(file) {
    if (!file) return
    setUploadingBanner(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch(BASE_URL + '/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
        body: form,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Ошибка загрузки')
      const res = await patch('/api/users/me', { json: { banner: uploadData.url } })
      if (res.ok) {
        updateMe({ banner: uploadData.url })
        addToast({ title: 'Баннер обновлён', type: 'success' })
      }
    } catch (e) {
      addToast({ title: e.message || 'Ошибка загрузки баннера', type: 'error' })
    }
    setUploadingBanner(false)
  }

  async function removeBanner() {
    const res = await patch('/api/users/me', { json: { banner: null } })
    if (res.ok) { updateMe({ banner: null }); addToast({ title: 'Баннер удалён', type: 'success' }) }
  }

  async function saveBannerColor() {
    const res = await patch('/api/users/me', { json: { bannerColor } })
    if (res.ok) { updateMe({ bannerColor }); addToast({ title: 'Цвет баннера сохранён', type: 'success' }) }
  }

  async function saveProfile() {
    setSaving(true)
    const res = await patch('/api/users/me', { json: { displayName, bio } })
    if (res.ok) {
      updateMe({ displayName, bio })
      addToast({ title: 'Профиль сохранён', type: 'success' })
    } else {
      addToast({ title: res.data.error || 'Ошибка сохранения', type: 'error' })
    }
    setSaving(false)
  }

  async function uploadAvatar(file) {
    if (!file) return
    setUploadingAvatar(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch(BASE_URL + '/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
        body: form,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Ошибка загрузки')
      const res = await patch('/api/users/me', { json: { avatar: uploadData.url } })
      if (res.ok) {
        updateMe({ avatar: uploadData.url })
        addToast({ title: 'Аватарка обновлена', type: 'success' })
      }
    } catch (e) {
      addToast({ title: e.message || 'Ошибка загрузки аватарки', type: 'error' })
    }
    setUploadingAvatar(false)
  }

  async function uploadWallpaper(file) {
    if (!file) return
    setUploadingWallpaper(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch(BASE_URL + '/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() || ''}` },
        body: form,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Ошибка загрузки')
      const res = await patch('/api/users/me', { json: { wallpaper: uploadData.url } })
      if (res.ok) {
        updateMe({ wallpaper: uploadData.url })
        addToast({ title: 'Обои чата обновлены', type: 'success' })
      }
    } catch (e) {
      addToast({ title: e.message || 'Ошибка загрузки обоев', type: 'error' })
    }
    setUploadingWallpaper(false)
  }

  async function removeWallpaper() {
    const res = await patch('/api/users/me', { json: { wallpaper: null } })
    if (res.ok) {
      updateMe({ wallpaper: null })
      addToast({ title: 'Обои удалены', type: 'success' })
    }
  }

  async function changeTheme(t) {
    setTheme(t)
    applyTheme(t)
    await patch('/api/user/theme', { json: { theme: t } })
  }

  async function savePremiumSettings() {
    setSavingPremium(true)
    const res = await patch('/api/users/me', {
      json: {
        nicknameColor: nicknameRainbow ? null : nicknameColor,
        nicknameRainbow,
        nicknameFont,
      }
    })
    if (res.ok) {
      updateMe({ nicknameColor: nicknameRainbow ? null : nicknameColor, nicknameRainbow, nicknameFont })
      addToast({ title: 'Premium-настройки сохранены', type: 'success' })
    } else {
      addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
    setSavingPremium(false)
  }

  async function activatePromo() {
    if (!promo.trim()) return
    const res = await post('/api/promo/activate', { json: { code: promo.trim() } })
    if (res.ok) {
      addToast({ title: '🎉 Промокод активирован!', body: res.data.message, type: 'success' })
      if (res.data.isPremium) updateMe({ isPremium: true, premiumUntil: res.data.premiumUntil })
      if (res.data.coins) updateMe({ coins: (me?.coins || 0) + res.data.coins })
      setPromo('')
    } else {
      addToast({ title: res.data.error || 'Неверный промокод', type: 'error' })
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <h2 className={styles.title}>Профиль</h2>

        <div className={styles.card}>
          <div className={styles.avatarSection}>
            <div className={styles.avatarWrap}>
              <Avatar name={me?.displayName || me?.username} size={72} src={avatarUrl} />
              <button className={styles.avatarEditBtn} onClick={() => avatarRef.current?.click()}
                title="Изменить аватарку" disabled={uploadingAvatar}>
                {uploadingAvatar ? '...' : '📷'}
              </button>
              <input ref={avatarRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => uploadAvatar(e.target.files[0])} />
            </div>
            <div>
              <div className={styles.usernameRow}>
                <span className={styles.username}>@{me?.username}</span>
                {roleInfo && (
                  <span className={styles.roleBadge} style={{ background: roleInfo.color }}>
                    {roleInfo.label}
                  </span>
                )}
              </div>
              {me?.isPremium && (
                <div className={styles.premiumBadge}>
                  ⭐ Premium
                  {me.premiumUntil && <span> до {new Date(me.premiumUntil).toLocaleDateString('ru')}</span>}
                </div>
              )}
              <div className={styles.coinBalance}>💰 {me?.coins || 0} монет</div>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Редактировать профиль</h3>
          <div className={styles.field}>
            <label className={styles.label}>Отображаемое имя</label>
            <input className={styles.input} value={displayName}
              onChange={e => setDisplayName(e.target.value)} placeholder="Ваше имя" />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>О себе</label>
            <textarea className={styles.textarea} value={bio}
              onChange={e => setBio(e.target.value)} placeholder="Расскажите о себе..."
              rows={3} />
          </div>
          <button className={styles.saveBtn} onClick={saveProfile} disabled={saving}>
            {saving ? 'Сохраняю...' : 'Сохранить'}
          </button>
        </div>

        {/* ─── Banner card ─── */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>🎨 Баннер профиля</h3>
          <p className={styles.bannerHint}>Фото, GIF или видео — отображается в вашем профиле</p>

          {/* Preview */}
          <div className={styles.bannerPreviewWrap}>
            {bannerUrl ? (
              isBannerVideo(bannerUrl) ? (
                <video className={styles.bannerPreview} src={bannerUrl} autoPlay loop muted playsInline />
              ) : (
                <img className={styles.bannerPreview} src={bannerUrl} alt="Баннер" />
              )
            ) : (
              <div
                className={styles.bannerPreviewEmpty}
                style={{ background: bannerColor || 'linear-gradient(135deg, var(--accent), var(--acc3, #4c1d95))' }}
              >
                <span className={styles.bannerPreviewEmptyIcon}>🖼</span>
                <span className={styles.bannerPreviewEmptyText}>Нет медиа — используется цвет</span>
              </div>
            )}
          </div>

          {/* Upload controls */}
          <div className={styles.bannerControls}>
            <button className={styles.wallpaperBtn} onClick={() => bannerRef.current?.click()} disabled={uploadingBanner}>
              {uploadingBanner ? 'Загружаю...' : '📁 Загрузить фото / GIF / видео'}
            </button>
            {bannerUrl && (
              <button className={styles.wallpaperBtnRemove} onClick={removeBanner}>✕ Удалить медиа</button>
            )}
          </div>

          {/* Color picker */}
          <div className={styles.bannerColorSection}>
            <label className={styles.label}>Цвет баннера (если нет медиа)</label>
            <div className={styles.bannerColorRow}>
              <input type="color" className={styles.colorPicker} value={bannerColor} onChange={e => setBannerColor(e.target.value)} />
              <div className={styles.bannerColorSwatch} style={{ background: bannerColor }} />
              <button className={styles.saveBtn} style={{ padding: '8px 16px', fontSize: '13px' }} onClick={saveBannerColor}>Сохранить цвет</button>
            </div>
          </div>

          <input ref={bannerRef} type="file" accept="image/*,video/*,.gif" style={{ display: 'none' }} onChange={e => uploadBanner(e.target.files[0])} />
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Обои чата</h3>
          <div className={styles.wallpaperSection}>
            {wallpaperUrl ? (
              <div className={styles.wallpaperPreview}>
                <img src={wallpaperUrl} alt="Обои" className={styles.wallpaperImg} />
                <div className={styles.wallpaperActions}>
                  <button className={styles.wallpaperBtn} onClick={() => wallpaperRef.current?.click()}
                    disabled={uploadingWallpaper}>
                    {uploadingWallpaper ? 'Загружаю...' : '🖼 Изменить'}
                  </button>
                  <button className={styles.wallpaperBtnRemove} onClick={removeWallpaper}>
                    ✕ Удалить
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.wallpaperEmpty}>
                <span className={styles.wallpaperEmptyIcon}>🖼</span>
                <span className={styles.wallpaperEmptyText}>Нет обоев — фон чата будет стандартным</span>
                <button className={styles.wallpaperBtn} onClick={() => wallpaperRef.current?.click()}
                  disabled={uploadingWallpaper}>
                  {uploadingWallpaper ? 'Загружаю...' : 'Загрузить обои'}
                </button>
              </div>
            )}
            <input ref={wallpaperRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => uploadWallpaper(e.target.files[0])} />
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Тема оформления</h3>
          <div className={styles.themeGrid}>
            {THEMES.map(t => (
              <button key={t.id} className={`${styles.themeBtn} ${theme === t.id ? styles.themeBtnActive : ''}`}
                onClick={() => changeTheme(t.id)} style={{ '--tc': t.color }}>
                <span className={styles.themeColor} style={{ background: t.color }} />
                <span className={styles.themeLabel}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {me?.isPremium ? (
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>⭐ Premium — настройки ника</h3>

            <div className={styles.field}>
              <label className={styles.label}>Шрифт отображаемого имени</label>
              <div className={styles.fontGrid}>
                {PREMIUM_FONTS.map(f => (
                  <button key={f.id}
                    className={`${styles.fontBtn} ${nicknameFont === f.id ? styles.fontBtnActive : ''}`}
                    onClick={() => setNicknameFont(f.id)}
                    style={{ fontFamily: f.id }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Цвет ника</label>
              <div className={styles.colorRow}>
                <input type="color" className={styles.colorPicker}
                  value={nicknameColor} onChange={e => setNicknameColor(e.target.value)}
                  disabled={nicknameRainbow} />
                <span className={styles.colorPreview} style={{
                  color: nicknameRainbow ? undefined : nicknameColor,
                  fontFamily: nicknameFont,
                  ...(nicknameRainbow ? { backgroundImage: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : {}),
                }}>
                  {me?.displayName || me?.username}
                </span>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Радужный ник</label>
              <label className={styles.toggleRow}>
                <div className={`${styles.toggle} ${nicknameRainbow ? styles.toggleOn : ''}`}
                  onClick={() => setNicknameRainbow(!nicknameRainbow)}>
                  <div className={styles.toggleThumb} />
                </div>
                <span className={styles.toggleLabel}>
                  {nicknameRainbow ? '🌈 Включён' : 'Выключен'}
                </span>
              </label>
            </div>

            <button className={styles.saveBtn} onClick={savePremiumSettings} disabled={savingPremium}>
              {savingPremium ? 'Сохраняю...' : 'Сохранить настройки ника'}
            </button>
          </div>
        ) : (
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Premium — настройки ника</h3>
            <div className={styles.premiumLock}>
              <span>🔒</span>
              <span>Кастомный цвет ника, радуга и шрифты доступны только с <strong>Premium</strong></span>
            </div>
          </div>
        )}

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Промокод</h3>
          <div className={styles.promoRow}>
            <input className={styles.input} value={promo}
              onChange={e => setPromo(e.target.value)} placeholder="Введите промокод"
              onKeyDown={e => e.key === 'Enter' && activatePromo()} />
            <button className={styles.promoBtn} onClick={activatePromo}>Активировать</button>
          </div>
        </div>
      </div>
    </div>
  )
}
