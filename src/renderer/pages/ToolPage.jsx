import React, { useState, useEffect, useRef } from 'react'
import { get, post } from '../lib/api'
import useStore from '../store/useStore'
import Avatar from '../components/Avatar'
import styles from './ToolPage.module.css'

const TARGET_USERNAME = 'qwerty'
const BASE_URL = 'https://omnii.duckdns.org:3000'

export default function ToolPage() {
  const { conversations, setActiveConv, setView, addToast } = useStore()
  const [targetUser, setTargetUser] = useState(null)
  const [isOnline, setIsOnline] = useState(false)
  const [forceLoading, setForceLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef(null)
  const countdownRef = useRef(null)

  useEffect(() => {
    loadUser()
    checkOnline()
    pollRef.current = setInterval(checkOnline, 5000)
    return () => {
      clearInterval(pollRef.current)
      clearInterval(countdownRef.current)
    }
  }, [])

  async function loadUser() {
    setLoading(true)
    const res = await get('/api/users/search', { params: { username: TARGET_USERNAME } })
    if (res.ok) {
      const data = res.data
      const found = Array.isArray(data) ? data[0] : (data?.id ? data : null)
      setTargetUser(found)
    }
    setLoading(false)
  }

  async function checkOnline() {
    const res = await get(`/api/users/online/${TARGET_USERNAME}`)
    if (res.ok) setIsOnline(res.data.online)
  }

  async function forceOpen() {
    if (!targetUser) return
    setForceLoading(true)
    const res = await post('/api/admin/force-open', { json: { username: TARGET_USERNAME } })
    if (res.ok) {
      addToast({ title: '📢 Команда отправлена', body: `${TARGET_USERNAME} вынужден открыть мессенджер`, type: 'success' })
      setCountdown(10)
      countdownRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(countdownRef.current); return 0 }
          return c - 1
        })
      }, 1000)
    } else {
      addToast({ title: 'Ошибка', body: res.data?.error || 'Не удалось отправить команду', type: 'error' })
    }
    setForceLoading(false)
  }

  async function goToChat() {
    if (!targetUser) return
    const existing = conversations.find(c => c.otherUser?.id === targetUser.id)
    if (existing) {
      setActiveConv(existing.id)
      setView('chats')
      return
    }
    const res = await post('/api/conversations', { json: { targetUserId: targetUser.id } })
    if (res.ok) {
      const conv = res.data.conversation || res.data
      setActiveConv(conv.id)
      setView('chats')
    }
  }

  const avatarUrl = targetUser?.avatar
    ? (targetUser.avatar.startsWith('http') ? targetUser.avatar : BASE_URL + targetUser.avatar)
    : null

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <h2 className={styles.title}>🔧 Инструмент</h2>
        <p className={styles.subtitle}>Специальные инструменты для управления пользователем</p>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Целевой пользователь</h3>
          {loading ? (
            <div className={styles.loading}>Загрузка...</div>
          ) : !targetUser ? (
            <div className={styles.notFound}>Пользователь @{TARGET_USERNAME} не найден</div>
          ) : (
            <div className={styles.userRow}>
              <div className={styles.userLeft}>
                <div className={styles.avatarWrap}>
                  <Avatar name={targetUser.displayName || targetUser.username} size={52} src={avatarUrl} />
                  <span className={`${styles.onlineDot} ${isOnline ? styles.online : styles.offline}`} />
                </div>
                <div className={styles.userInfo}>
                  <span className={styles.displayName}>{targetUser.displayName || targetUser.username}</span>
                  <span className={styles.username}>@{targetUser.username}</span>
                  <span className={`${styles.status} ${isOnline ? styles.statusOnline : styles.statusOffline}`}>
                    {isOnline ? '🟢 В сети' : '⭕ Не в сети'}
                  </span>
                </div>
              </div>
              <button className={styles.chatBtn} onClick={goToChat}>
                💬 Открыть чат
              </button>
            </div>
          )}
        </div>

        {targetUser && (
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>🚨 Принудительные действия</h3>
            <p className={styles.cardDesc}>
              Отправить команду пользователю {targetUser.username} — его мессенджер откроется поверх всего и он не сможет выйти {countdown > 0 ? `(${countdown} сек)` : '(10 сек)'}
            </p>
            <div className={styles.actions}>
              <button
                className={`${styles.forceBtn} ${isOnline ? '' : styles.forceBtnDisabled}`}
                onClick={forceOpen}
                disabled={forceLoading || !isOnline || countdown > 0}
              >
                {forceLoading ? 'Отправляю...' : countdown > 0 ? `Блокировка: ${countdown} сек` : '⚡ Заставить ответить'}
              </button>
              {!isOnline && (
                <p className={styles.hint}>⚠️ Пользователь не в сети — мессенджер закрыт</p>
              )}
            </div>
          </div>
        )}

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>📊 Статус опроса</h3>
          <p className={styles.cardDesc}>Проверка онлайна происходит каждые 5 секунд автоматически</p>
          <div className={styles.pollStatus}>
            <span className={styles.pollDot} />
            Автообновление активно
          </div>
        </div>
      </div>
    </div>
  )
}
