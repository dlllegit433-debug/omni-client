import React, { useState } from 'react'
import useStore, { applyTheme } from '../store/useStore'
import { patch, post } from '../lib/api'
import Avatar from '../components/Avatar'
import styles from './ProfilePage.module.css'

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

export default function ProfilePage() {
  const { me, updateMe, theme, setTheme, addToast } = useStore()
  const [displayName, setDisplayName] = useState(me?.displayName || '')
  const [bio, setBio] = useState(me?.bio || '')
  const [promo, setPromo] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveProfile() {
    setSaving(true)
    const res = await patch('/api/user/profile', { json: { displayName, bio } })
    if (res.ok) {
      updateMe({ displayName, bio })
      addToast({ title: 'Профиль сохранён', type: 'success' })
    } else {
      addToast({ title: res.data.error || 'Ошибка сохранения', type: 'error' })
    }
    setSaving(false)
  }

  async function changeTheme(t) {
    setTheme(t)
    applyTheme(t)
    await patch('/api/user/theme', { json: { theme: t } })
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

        {/* Avatar + name */}
        <div className={styles.card}>
          <div className={styles.avatarSection}>
            <Avatar name={me?.displayName || me?.username} size={72} />
            <div>
              <div className={styles.username}>@{me?.username}</div>
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

        {/* Edit profile */}
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

        {/* Themes */}
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

        {/* Promo */}
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
