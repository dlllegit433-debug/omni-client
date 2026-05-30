import React, { useState } from 'react'
import { get, post } from '../../lib/api'
import Avatar from '../Avatar'
import useStore from '../../store/useStore'
import styles from './NewChatModal.module.css'

export default function NewChatModal({ onClose }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState([])
  const [groupName, setGroupName] = useState('')
  const { setActiveConv, setView } = useStore()

  async function doSearch() {
    if (!search.trim()) return
    setLoading(true)
    const res = await get('/api/users/search', { params: { username: search, multi: '1' } })
    if (res.ok) {
      const data = res.data
      if (Array.isArray(data)) setResults(data)
      else if (data?.id) setResults([data])
      else setResults([])
    } else {
      setResults([])
    }
    setLoading(false)
  }

  function toggleSelect(user) {
    setSelected(prev =>
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    )
  }

  async function createChat() {
    if (selected.length === 0) return
    if (selected.length === 1) {
      const res = await post('/api/conversations', {
        json: { targetUserId: selected[0].id }
      })
      if (res.ok) {
        const conv = res.data.conversation || res.data
        useStore.getState().conversations.length > 0 || await get('/api/conversations')
        setActiveConv(conv.id)
        setView('chats')
        onClose()
      }
    } else {
      if (!groupName.trim()) return useStore.getState().addToast({ title: 'Укажите название группы', type: 'warning' })
      const res = await post('/api/groups', {
        json: { name: groupName, memberIds: selected.map(u => u.id) }
      })
      if (res.ok) {
        const conv = res.data.conversation || res.data
        setActiveConv(conv.id)
        setView('chats')
        onClose()
      }
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span>{selected.length > 1 ? 'Новая группа' : 'Новый чат'}</span>
          <button onClick={onClose}>✕</button>
        </div>

        {selected.length > 1 && (
          <div className={styles.field}>
            <input className={styles.input} placeholder="Название группы"
              value={groupName} onChange={e => setGroupName(e.target.value)} />
          </div>
        )}

        {selected.length > 0 && (
          <div className={styles.selected}>
            {selected.map(u => (
              <span key={u.id} className={styles.selectedChip}>
                {u.displayName || u.username}
                <button onClick={() => toggleSelect(u)}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.searchRow}>
          <input className={styles.input} placeholder="Поиск пользователя..."
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()} />
          <button className={styles.searchBtn} onClick={doSearch}>
            {loading ? '...' : 'Найти'}
          </button>
        </div>

        <div className={styles.results}>
          {results.map(u => (
            <div key={u.id} className={`${styles.userRow} ${selected.find(s => s.id === u.id) ? styles.userSelected : ''}`}
              onClick={() => toggleSelect(u)}>
              <Avatar name={u.displayName || u.username} size={32} />
              <div className={styles.userInfo}>
                <span className={styles.userName}>{u.displayName || u.username}</span>
                <span className={styles.userSub}>@{u.username}</span>
              </div>
              {selected.find(s => s.id === u.id) && <span className={styles.check}>✓</span>}
            </div>
          ))}
        </div>

        <button className={styles.createBtn} onClick={createChat} disabled={selected.length === 0}>
          {selected.length > 1 ? 'Создать группу' : 'Начать чат'}
        </button>
      </div>
    </div>
  )
}
