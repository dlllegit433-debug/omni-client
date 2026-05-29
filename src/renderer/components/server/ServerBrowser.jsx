import React, { useState, useEffect } from 'react'
import { get, post } from '../../lib/api'
import Avatar from '../Avatar'
import useStore from '../../store/useStore'
import styles from './ServerBrowser.module.css'

export default function ServerBrowser({ onClose }) {
  const [tab, setTab] = useState('public')
  const [servers, setServers] = useState([])
  const [code, setCode] = useState('')
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tab === 'public') loadPublic()
  }, [tab])

  async function loadPublic() {
    setLoading(true)
    const res = await get('/api/servers/public')
    if (res.ok) setServers(res.data.servers || res.data || [])
    setLoading(false)
  }

  async function joinByCode() {
    if (!code.trim()) return
    const res = await post(`/api/servers/join/${code.trim()}`)
    if (res.ok) {
      useStore.getState().addToast({ title: 'Вступил на сервер!', type: 'success' })
      onClose()
    } else {
      useStore.getState().addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  async function joinServer(serverId) {
    const res = await post(`/api/servers/${serverId}/join`)
    if (res.ok) {
      useStore.getState().addToast({ title: 'Вступил на сервер!', type: 'success' })
      onClose()
    } else {
      useStore.getState().addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  async function createServer() {
    if (!newName.trim()) return
    const res = await post('/api/servers', { json: { name: newName } })
    if (res.ok) {
      useStore.getState().addToast({ title: 'Сервер создан!', type: 'success' })
      onClose()
    } else {
      useStore.getState().addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span>Серверы</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className={styles.tabs}>
          {['public','code','create'].map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              {{ public: '🌐 Публичные', code: '🔑 По коду', create: '➕ Создать' }[t]}
            </button>
          ))}
        </div>

        {tab === 'public' && (
          <div className={styles.list}>
            {loading && <div className={styles.empty}>Загрузка...</div>}
            {!loading && servers.length === 0 && <div className={styles.empty}>Нет публичных серверов</div>}
            {servers.map(s => (
              <div key={s.id} className={styles.serverRow}>
                <Avatar name={s.name} size={40} />
                <div className={styles.serverInfo}>
                  <span className={styles.serverName}>{s.name}</span>
                  <span className={styles.serverDesc}>{s.description || ''}</span>
                  <span className={styles.serverMeta}>{s.memberCount} участников</span>
                </div>
                <button className={styles.joinBtn} onClick={() => joinServer(s.id)}>Вступить</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'code' && (
          <div className={styles.codeTab}>
            <p className={styles.hint}>Введите код приглашения на сервер</p>
            <div className={styles.codeRow}>
              <input className={styles.input} placeholder="Код приглашения" value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && joinByCode()} />
              <button className={styles.joinBtn} onClick={joinByCode}>Войти</button>
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div className={styles.codeTab}>
            <p className={styles.hint}>Создайте свой сервер</p>
            <input className={styles.input} placeholder="Название сервера" value={newName}
              onChange={e => setNewName(e.target.value)} />
            <button className={styles.createBtn} onClick={createServer}>Создать сервер</button>
          </div>
        )}
      </div>
    </div>
  )
}
