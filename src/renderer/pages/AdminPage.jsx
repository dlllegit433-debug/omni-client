import React, { useState, useEffect } from 'react'
import { get, post, del, patch } from '../lib/api'
import useStore from '../store/useStore'
import Avatar from '../components/Avatar'
import styles from './AdminPage.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

const ROLE_INFO = {
  creator: { label: 'Creator', color: '#4c1d95' },
  curator: { label: 'Curator', color: '#0c4a6e' },
  owner:   { label: 'Owner',   color: '#92400e' },
}

const MUTE_PRESETS = [
  { label: '15 мин', minutes: 15 },
  { label: '1 час',  minutes: 60 },
  { label: '6 ч',    minutes: 360 },
  { label: '24 ч',   minutes: 1440 },
  { label: '7 дней', minutes: 10080 },
]

export default function AdminPage() {
  const { me, addToast } = useStore()
  const [tab, setTab] = useState('stats')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [promos, setPromos] = useState([])
  const [newPromo, setNewPromo] = useState({ code: '', durationDays: 30, maxUses: 100 })
  const [coinsTarget, setCoinsTarget] = useState('')
  const [coinsAmount, setCoinsAmount] = useState('')
  const [muteModal, setMuteModal] = useState(null)
  const [muteMinutes, setMuteMinutes] = useState(60)
  const [banModal, setBanModal] = useState(null)
  const [banReason, setBanReason] = useState('Нарушение правил')

  const isCreator = me?.globalRole === 'creator'
  const isCurator = me?.globalRole === 'curator'

  useEffect(() => {
    if (tab === 'stats') loadStats()
    if (tab === 'users') loadUsers()
    if (tab === 'promos') loadPromos()
  }, [tab])

  async function loadStats() {
    const res = await get('/api/admin/stats')
    if (res.ok) setStats(res.data)
    else addToast({ title: 'Ошибка загрузки статистики', body: res.data?.error, type: 'error' })
  }

  async function loadUsers(q = '') {
    const res = await get('/api/admin/users', { params: q ? { search: q } : {} })
    if (res.ok) setUsers(res.data.users || res.data || [])
    else addToast({ title: 'Ошибка загрузки пользователей', body: res.data?.error, type: 'error' })
  }

  async function loadPromos() {
    const res = await get('/api/admin/promos')
    if (res.ok) setPromos(res.data.promos || res.data || [])
    else addToast({ title: 'Ошибка загрузки промокодов', body: res.data?.error, type: 'error' })
  }

  function canModerate(targetUser) {
    if (!targetUser) return false
    if (targetUser.id === me?.id) return false
    const targetRole = targetUser.globalRole || 'user'
    if (isCreator) return true
    if (isCurator) return targetRole !== 'creator' && targetRole !== 'curator'
    return targetRole === 'user'
  }

  async function banUser(u) {
    setBanModal(u)
    setBanReason('Нарушение правил')
  }

  async function confirmBan() {
    const u = banModal
    setBanModal(null)
    const res = await post(`/api/admin/users/${u.id}/ban`, { json: { reason: banReason || 'Нарушение правил' } })
    if (res.ok) { addToast({ title: `@${u.username} забанен`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function unbanUser(u) {
    const res = await post(`/api/admin/users/${u.id}/unban`)
    if (res.ok) { addToast({ title: `Бан снят с @${u.username}`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function freezeUser(u) {
    const res = await post(`/api/admin/users/${u.id}/freeze`)
    if (res.ok) { addToast({ title: `@${u.username} заморожен`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function unfreezeUser(u) {
    const res = await post(`/api/admin/users/${u.id}/unfreeze`)
    if (res.ok) { addToast({ title: `Заморозка снята с @${u.username}`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function muteUser(u, minutes) {
    const res = await post(`/api/admin/users/${u.id}/mute`, { json: { minutes } })
    if (res.ok) {
      addToast({ title: `@${u.username} замьючен на ${minutes} мин.`, type: 'success' })
      setMuteModal(null)
      loadUsers(userSearch)
    } else {
      addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
    }
  }

  async function unmuteUser(u) {
    const res = await post(`/api/admin/users/${u.id}/unmute`)
    if (res.ok) { addToast({ title: `Мут снят с @${u.username}`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function grantPremium(u) {
    const res = await post(`/api/admin/users/${u.id}/premium`, { json: { days: 30 } })
    if (res.ok) { addToast({ title: `Premium выдан @${u.username}`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function revokePremium(u) {
    const res = await del(`/api/admin/users/${u.id}/premium`)
    if (res.ok) { addToast({ title: `Premium отозван у @${u.username}`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function setRole(u, globalRole) {
    const res = await patch(`/api/admin/users/${u.id}/role`, { json: { globalRole } })
    if (res.ok) { addToast({ title: `Роль изменена`, type: 'success' }); loadUsers(userSearch) }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function addCoins() {
    if (!coinsTarget || !coinsAmount) return
    const res = await post('/api/admin/coins', { json: { username: coinsTarget, amount: parseInt(coinsAmount) } })
    if (res.ok) {
      addToast({ title: `Начислено ${coinsAmount} монет → ${coinsTarget}`, type: 'success' })
      setCoinsTarget(''); setCoinsAmount('')
    } else {
      addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
    }
  }

  async function createPromo() {
    if (!newPromo.code.trim()) return
    const res = await post('/api/admin/promos', { json: newPromo })
    if (res.ok) { addToast({ title: 'Промокод создан', type: 'success' }); loadPromos() }
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  async function deletePromo(code) {
    const res = await del(`/api/admin/promos/${code}`)
    if (res.ok) loadPromos()
    else addToast({ title: res.data?.error || 'Ошибка', type: 'error' })
  }

  if (!me?.isAdmin) {
    return <div className={styles.denied}>❌ Доступ запрещён</div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h2 className={styles.title}>Панель администратора</h2>
          {ROLE_INFO[me?.globalRole] && (
            <span className={styles.myRole} style={{ background: ROLE_INFO[me.globalRole].color }}>
              {ROLE_INFO[me.globalRole].label}
            </span>
          )}
        </div>

        <div className={styles.tabs}>
          {[
            { id: 'stats',  label: '📊 Статистика' },
            { id: 'users',  label: '👥 Пользователи' },
            { id: 'promos', label: '🎟 Промокоды' },
            { id: 'coins',  label: '💰 Монеты' },
          ].map(t => (
            <button key={t.id} className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'stats' && (
          <div className={styles.statsGrid}>
            <StatCard icon="👥" label="Пользователи" value={stats?.totalUsers ?? stats?.users} />
            <StatCard icon="🖥" label="Серверы" value={stats?.totalServers ?? stats?.servers} />
            <StatCard icon="💬" label="Сообщения" value={stats?.totalMessages ?? stats?.messages} />
            <StatCard icon="⭐" label="Premium" value={stats?.premiumUsers} />
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
              {users.length === 0 && <div className={styles.empty}>Нет пользователей</div>}
              {users.map(u => {
                const avatarUrl = u.avatar ? (u.avatar.startsWith('http') ? u.avatar : BASE_URL + u.avatar) : null
                const roleInfo = ROLE_INFO[u.globalRole]
                const canMod = canModerate(u)
                return (
                  <div key={u.id} className={styles.userRow}>
                    <Avatar name={u.displayName || u.username} size={36} src={avatarUrl} />
                    <div className={styles.userInfo}>
                      <div className={styles.uNameRow}>
                        <span className={styles.uName}>{u.displayName || u.username}</span>
                        {roleInfo && (
                          <span className={styles.rolePill} style={{ background: roleInfo.color }}>
                            {roleInfo.label}
                          </span>
                        )}
                        {u.isAdmin && !roleInfo && (
                          <span className={styles.rolePill} style={{ background: '#374151' }}>Admin</span>
                        )}
                      </div>
                      <span className={styles.uSub}>@{u.username}
                        {u.isBanned && <span className={styles.badge_red}> 🚫 забанен</span>}
                        {u.isFrozen && <span className={styles.badge_blue}> ❄️ заморожен</span>}
                        {u.isMuted && <span className={styles.badge_yellow}> 🔇 мут{u.muteUntil ? ` до ${new Date(u.muteUntil).toLocaleString('ru', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : ''}</span>}
                        {u.isPremium && <span className={styles.badge_gold}> ⭐ premium</span>}
                      </span>
                    </div>
                    <div className={styles.userActions}>
                      {canMod && (
                        <>
                          {u.isBanned
                            ? <button className={styles.aBtn} onClick={() => unbanUser(u)}>Разбанить</button>
                            : <button className={styles.aBtnRed} onClick={() => banUser(u)}>Бан</button>
                          }
                          {u.isFrozen
                            ? <button className={styles.aBtn} onClick={() => unfreezeUser(u)}>Разморозить</button>
                            : <button className={styles.aBtnBlue} onClick={() => freezeUser(u)}>Заморозить</button>
                          }
                          {u.isMuted
                            ? <button className={styles.aBtn} onClick={() => unmuteUser(u)}>Снять мут</button>
                            : <button className={styles.aBtnYellow} onClick={() => setMuteModal(u)}>Мут</button>
                          }
                          {u.isPremium
                            ? <button className={styles.aBtn} onClick={() => revokePremium(u)}>-Premium</button>
                            : <button className={styles.aBtnGold} onClick={() => grantPremium(u)}>+Premium</button>
                          }
                        </>
                      )}
                      {isCreator && u.id !== me?.id && (
                        <select className={styles.roleSelect}
                          value={u.globalRole || 'user'}
                          onChange={e => setRole(u, e.target.value)}>
                          <option value="user">Обычный</option>
                          <option value="owner">Owner</option>
                          <option value="curator">Curator</option>
                          <option value="creator">Creator</option>
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'promos' && (
          <div className={styles.section}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Создать промокод</h3>
              <div className={styles.promoForm}>
                <input className={styles.input} placeholder="Код (например: SUMMER24)" value={newPromo.code}
                  onChange={e => setNewPromo(p => ({ ...p, code: e.target.value }))} />
                <input className={styles.inputSmall} type="number" placeholder="Дней Premium"
                  value={newPromo.durationDays}
                  onChange={e => setNewPromo(p => ({ ...p, durationDays: parseInt(e.target.value) || 30 }))} />
                <input className={styles.inputSmall} type="number" placeholder="Макс. исп."
                  value={newPromo.maxUses}
                  onChange={e => setNewPromo(p => ({ ...p, maxUses: parseInt(e.target.value) || 100 }))} />
                <button className={styles.createBtn} onClick={createPromo}>Создать</button>
              </div>
            </div>
            <div className={styles.promoList}>
              {promos.length === 0 && <div className={styles.empty}>Нет промокодов</div>}
              {promos.map(p => (
                <div key={p.code} className={styles.promoRow}>
                  <div className={styles.promoCode}>{p.code}</div>
                  <div className={styles.promoMeta}>
                    {p.usedCount}/{p.maxUses} исп. · {p.durationDays} дней Premium
                  </div>
                  <button className={styles.deleteBtn} onClick={() => deletePromo(p.code)}>✕</button>
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
                <input className={styles.inputSmall} type="number" placeholder="Количество"
                  value={coinsAmount} onChange={e => setCoinsAmount(e.target.value)} />
                <button className={styles.createBtn} onClick={addCoins}>Начислить</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {muteModal && (
        <div className={styles.modalOverlay} onClick={() => setMuteModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>🔇 Мут @{muteModal.username}</div>
            <div className={styles.mutePresets}>
              {MUTE_PRESETS.map(p => (
                <button key={p.minutes} className={styles.mutePreset}
                  onClick={() => muteUser(muteModal, p.minutes)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className={styles.muteCustomRow}>
              <input type="number" className={styles.muteInput} placeholder="Минуты"
                value={muteMinutes} onChange={e => setMuteMinutes(parseInt(e.target.value) || 60)} min={1} />
              <button className={styles.muteBtn}
                onClick={() => muteUser(muteModal, muteMinutes)}>
                Применить
              </button>
            </div>
            <button className={styles.modalClose} onClick={() => setMuteModal(null)}>Отмена</button>
          </div>
        </div>
      )}

      {banModal && (
        <div className={styles.modalOverlay} onClick={() => setBanModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>🚫 Бан @{banModal.username}</div>
            <input
              className={styles.input}
              placeholder="Причина бана"
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={styles.aBtnRed} onClick={confirmBan}>Забанить</button>
              <button className={styles.modalClose} onClick={() => setBanModal(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
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
