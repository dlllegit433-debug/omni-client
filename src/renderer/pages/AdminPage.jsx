import React, { useState, useEffect } from 'react'
import { get, post, del } from '../lib/api'
import useStore from '../store/useStore'
import Avatar from '../components/Avatar'
import styles from './AdminPage.module.css'

export default function AdminPage() {
  const { me } = useStore()
  const [tab, setTab] = useState('stats')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [promos, setPromos] = useState([])
  const [newPromo, setNewPromo] = useState({ code: '', durationDays: 30, maxUses: 100 })
  const [coinsTarget, setCoinsTarget] = useState('')
  const [coinsAmount, setCoinsAmount] = useState('')
  const { addToast } = useStore()

  useEffect(() => {
    if (tab === 'stats') loadStats()
    if (tab === 'users') loadUsers()
    if (tab === 'promos') loadPromos()
  }, [tab])

  async function loadStats() {
    const res = await get('/api/admin/stats')
    if (res.ok) setStats(res.data)
  }

  async function loadUsers(q = '') {
    const res = await get('/api/admin/users', { params: q ? { search: q } : {} })
    if (res.ok) setUsers(res.data.users || res.data || [])
  }

  async function loadPromos() {
    const res = await get('/api/admin/promos')
    if (res.ok) setPromos(res.data.promos || res.data || [])
  }

  async function banUser(userId, reason = 'Нарушение правил') {
    const res = await post(`/api/admin/users/${userId}/ban`, { json: { reason } })
    if (res.ok) { addToast({ title: 'Пользователь забанен', type: 'success' }); loadUsers() }
  }

  async function unbanUser(userId) {
    const res = await post(`/api/admin/users/${userId}/unban`)
    if (res.ok) { addToast({ title: 'Бан снят', type: 'success' }); loadUsers() }
  }

  async function freezeUser(userId) {
    const res = await post(`/api/admin/users/${userId}/freeze`)
    if (res.ok) { addToast({ title: 'Аккаунт заморожен', type: 'success' }); loadUsers() }
  }

  async function unfreezeUser(userId) {
    const res = await post(`/api/admin/users/${userId}/unfreeze`)
    if (res.ok) { addToast({ title: 'Заморозка снята', type: 'success' }); loadUsers() }
  }

  async function grantPremium(userId) {
    const res = await post(`/api/admin/users/${userId}/premium`, { json: { days: 30 } })
    if (res.ok) { addToast({ title: 'Premium выдан', type: 'success' }); loadUsers() }
  }

  async function revokePremium(userId) {
    const res = await del(`/api/admin/users/${userId}/premium`)
    if (res.ok) { addToast({ title: 'Premium отозван', type: 'success' }); loadUsers() }
  }

  async function addCoins() {
    if (!coinsTarget || !coinsAmount) return
    const res = await post('/api/admin/coins', { json: { username: coinsTarget, amount: parseInt(coinsAmount) } })
    if (res.ok) {
      addToast({ title: `Начислено ${coinsAmount} монет → ${coinsTarget}`, type: 'success' })
      setCoinsTarget(''); setCoinsAmount('')
    } else {
      addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  async function createPromo() {
    if (!newPromo.code.trim()) return
    const res = await post('/api/admin/promos', { json: newPromo })
    if (res.ok) { addToast({ title: 'Промокод создан', type: 'success' }); loadPromos() }
    else addToast({ title: res.data.error || 'Ошибка', type: 'error' })
  }

  async function deletePromo(id) {
    const res = await del(`/api/admin/promos/${id}`)
    if (res.ok) loadPromos()
  }

  if (!me?.isAdmin) {
    return <div className={styles.denied}>❌ Доступ запрещён</div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <h2 className={styles.title}>Панель администратора</h2>

        <div className={styles.tabs}>
          {['stats','users','promos','coins'].map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              {{ stats: '📊 Статистика', users: '👥 Пользователи', promos: '🎟 Промокоды', coins: '💰 Монеты' }[t]}
            </button>
          ))}
        </div>

        {tab === 'stats' && stats && (
          <div className={styles.statsGrid}>
            <StatCard icon="👥" label="Пользователи" value={stats.totalUsers} />
            <StatCard icon="🖥" label="Серверы" value={stats.totalServers} />
            <StatCard icon="💬" label="Сообщения" value={stats.totalMessages} />
            <StatCard icon="⭐" label="Premium" value={stats.premiumUsers} />
          </div>
        )}

        {tab === 'users' && (
          <div className={styles.section}>
            <div className={styles.searchRow}>
              <input className={styles.input} placeholder="Поиск пользователя..."
                value={userSearch} onChange={e => setUserSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadUsers(userSearch)} />
              <button className={styles.searchBtn} onClick={() => loadUsers(userSearch)}>Найти</button>
            </div>
            <div className={styles.userList}>
              {users.map(u => (
                <div key={u.id} className={styles.userRow}>
                  <Avatar name={u.displayName || u.username} size={36} />
                  <div className={styles.userInfo}>
                    <span className={styles.uName}>{u.displayName || u.username}</span>
                    <span className={styles.uSub}>@{u.username}
                      {u.isBanned && <span className={styles.badge_red}> 🚫 забанен</span>}
                      {u.isFrozen && <span className={styles.badge_blue}> ❄️ заморожен</span>}
                      {u.isMuted && <span className={styles.badge_yellow}> 🔇 мут</span>}
                      {u.isPremium && <span className={styles.badge_gold}> ⭐ premium</span>}
                    </span>
                  </div>
                  <div className={styles.userActions}>
                    {u.isBanned
                      ? <button className={styles.aBtn} onClick={() => unbanUser(u.id)}>Разбанить</button>
                      : <button className={styles.aBtnRed} onClick={() => banUser(u.id)}>Бан</button>
                    }
                    {u.isFrozen
                      ? <button className={styles.aBtn} onClick={() => unfreezeUser(u.id)}>Разморозить</button>
                      : <button className={styles.aBtnBlue} onClick={() => freezeUser(u.id)}>Заморозить</button>
                    }
                    {u.isPremium
                      ? <button className={styles.aBtn} onClick={() => revokePremium(u.id)}>-Premium</button>
                      : <button className={styles.aBtnGold} onClick={() => grantPremium(u.id)}>+Premium</button>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'promos' && (
          <div className={styles.section}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Создать промокод</h3>
              <div className={styles.promoForm}>
                <input className={styles.input} placeholder="Код" value={newPromo.code}
                  onChange={e => setNewPromo(p => ({ ...p, code: e.target.value }))} />
                <input className={styles.input} type="number" placeholder="Дней (30)"
                  value={newPromo.durationDays}
                  onChange={e => setNewPromo(p => ({ ...p, durationDays: parseInt(e.target.value) }))} />
                <input className={styles.input} type="number" placeholder="Макс. использований"
                  value={newPromo.maxUses}
                  onChange={e => setNewPromo(p => ({ ...p, maxUses: parseInt(e.target.value) }))} />
                <button className={styles.createBtn} onClick={createPromo}>Создать</button>
              </div>
            </div>
            <div className={styles.promoList}>
              {promos.map(p => (
                <div key={p.id} className={styles.promoRow}>
                  <div className={styles.promoCode}>{p.code}</div>
                  <div className={styles.promoMeta}>
                    {p.usedCount}/{p.maxUses} использований · {p.durationDays} дней
                  </div>
                  <button className={styles.deleteBtn} onClick={() => deletePromo(p.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'coins' && (
          <div className={styles.section}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Начислить монеты</h3>
              <div className={styles.coinsForm}>
                <input className={styles.input} placeholder="@username"
                  value={coinsTarget} onChange={e => setCoinsTarget(e.target.value)} />
                <input className={styles.input} type="number" placeholder="Количество"
                  value={coinsAmount} onChange={e => setCoinsAmount(e.target.value)} />
                <button className={styles.createBtn} onClick={addCoins}>Начислить</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }) {
  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '20px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}>
      <span style={{ fontSize: 36 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>{value ?? '—'}</div>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{label}</div>
      </div>
    </div>
  )
}
