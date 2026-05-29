import React, { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { get, post, del, patch } from '../../lib/api'
import Avatar from '../Avatar'
import styles from './ServerView.module.css'

export default function ServerView({ getWs }) {
  const { me, servers, activeServerId, activeChannelId, setActiveChannel,
    serverChannels, setServerChannels, serverMembers, setServerMembers,
    channelMessages, setChannelMessages, appendChannelMessage } = useStore()

  const server = servers.find(s => s.id === activeServerId)
  const channels = serverChannels[activeServerId] || []
  const members = serverMembers[activeServerId] || []
  const messages = channelMessages[activeChannelId] || []

  const [input, setInput] = useState('')
  const [showManage, setShowManage] = useState(false)

  useEffect(() => {
    if (!activeServerId) return
    loadChannels()
    loadMembers()
    const ws = getWs()
    ws?.send({ type: 'subscribe_server', serverId: activeServerId })
  }, [activeServerId])

  useEffect(() => {
    if (!activeChannelId) return
    loadChannelMessages()
  }, [activeChannelId])

  async function loadChannels() {
    const res = await get(`/api/servers/${activeServerId}/channels`)
    if (res.ok) setServerChannels(activeServerId, res.data.channels || res.data || [])
  }

  async function loadMembers() {
    const res = await get(`/api/servers/${activeServerId}/members`)
    if (res.ok) setServerMembers(activeServerId, res.data.members || res.data || [])
  }

  async function loadChannelMessages() {
    const res = await get(`/api/channels/${activeChannelId}/messages`)
    if (res.ok) setChannelMessages(activeChannelId, res.data.messages || res.data || [])
  }

  async function sendMessage() {
    const content = input.trim()
    if (!content) return
    setInput('')
    await post(`/api/channels/${activeChannelId}/messages`, { json: { content } })
  }

  const textChannels = channels.filter(c => c.type === 'text' || !c.type)
  const voiceChannels = channels.filter(c => c.type === 'voice')

  return (
    <div className={styles.root}>
      {/* Channel list */}
      <div className={styles.channelSidebar}>
        <div className={styles.serverHeader}>
          <span className={styles.serverName}>{server?.name}</span>
          {(me?.isAdmin || server?.ownerUsername === me?.username) && (
            <button className={styles.manageBtn} onClick={() => setShowManage(true)} title="Управление">
              ⚙
            </button>
          )}
        </div>

        {textChannels.length > 0 && (
          <div className={styles.channelGroup}>
            <div className={styles.channelGroupLabel}>Текстовые</div>
            {textChannels.map(ch => (
              <button key={ch.id}
                className={`${styles.channel} ${activeChannelId === ch.id ? styles.channelActive : ''}`}
                onClick={() => setActiveChannel(ch.id)}>
                <span className={styles.channelHash}>#</span>
                <span>{ch.name}</span>
              </button>
            ))}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div className={styles.channelGroup}>
            <div className={styles.channelGroupLabel}>Голосовые</div>
            {voiceChannels.map(ch => (
              <button key={ch.id}
                className={`${styles.channel} ${activeChannelId === ch.id ? styles.channelActive : ''}`}
                onClick={() => setActiveChannel(ch.id)}>
                <span className={styles.channelHash}>🔊</span>
                <span>{ch.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className={styles.content}>
        {activeChannelId ? (
          <>
            <div className={styles.chanHeader}>
              <span className={styles.chanHashBig}>#</span>
              <span className={styles.chanName}>{channels.find(c => c.id === activeChannelId)?.name}</span>
            </div>

            <div className={styles.messages}>
              {messages.map((msg, i) => {
                const senderName = msg.sender?.displayName || msg.sender?.username || 'Неизвестно'
                const isMe = msg.sender?.id === me?.id
                const showAvatar = i === 0 || messages[i-1]?.sender?.id !== msg.sender?.id
                return (
                  <div key={msg.id} className={styles.msg}>
                    <div className={styles.msgAvatar}>
                      {showAvatar ? <Avatar name={senderName} size={36} /> : <div style={{ width: 36 }} />}
                    </div>
                    <div className={styles.msgBody}>
                      {showAvatar && (
                        <div className={styles.msgMeta}>
                          <span className={styles.msgName}>{senderName}</span>
                          <span className={styles.msgTime}>{fmtTime(msg.createdAt)}</span>
                        </div>
                      )}
                      <div className={styles.msgText}>{msg.content}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className={styles.inputArea}>
              <input
                className={styles.input}
                placeholder={`Сообщение в #${channels.find(c => c.id === activeChannelId)?.name || ''}`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendMessage() }}
              />
              <button className={styles.sendBtn} onClick={sendMessage}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className={styles.noChannel}>
            <span className={styles.noChannelIcon}>📢</span>
            <span>Выберите канал</span>
          </div>
        )}
      </div>

      {/* Member list */}
      <div className={styles.memberSidebar}>
        <div className={styles.memberHeader}>Участники — {members.length}</div>
        {members.map(m => (
          <div key={m.id || m.userId} className={styles.member}>
            <div className={styles.memberAvatarWrap}>
              <Avatar name={m.displayName || m.username} size={32} />
              <span className={`${styles.memberDot} ${m.online ? styles.memberDotGreen : styles.memberDotGray}`} />
            </div>
            <div className={styles.memberInfo}>
              <span className={styles.memberName}>{m.displayName || m.username}</span>
              {m.role && <span className={styles.memberRole} style={{ color: m.roleColor || 'var(--accent)' }}>
                {m.role}
              </span>}
            </div>
          </div>
        ))}
      </div>

      {showManage && (
        <ServerManageModal serverId={activeServerId} server={server}
          onClose={() => { setShowManage(false); loadChannels(); loadMembers() }} />
      )}
    </div>
  )
}

function ServerManageModal({ serverId, server, onClose }) {
  const [tab, setTab] = useState('general')
  const [name, setName] = useState(server?.name || '')
  const [desc, setDesc] = useState(server?.description || '')
  const [isPublic, setIsPublic] = useState(server?.isPublic || false)
  const [members, setMembers] = useState([])
  const [bans, setBans] = useState([])
  const [newChanName, setNewChanName] = useState('')
  const [newChanType, setNewChanType] = useState('text')

  useEffect(() => {
    get(`/api/servers/${serverId}/members`).then(r => r.ok && setMembers(r.data.members || r.data || []))
    get(`/api/servers/${serverId}/bans`).then(r => r.ok && setBans(r.data.bans || r.data || []))
  }, [])

  async function saveGeneral() {
    await patch(`/api/servers/${serverId}`, { json: { name, description: desc, isPublic } })
    useStore.getState().addToast({ title: 'Сохранено', type: 'success' })
  }

  async function kickMember(userId) {
    await del(`/api/servers/${serverId}/members/${userId}`)
    setMembers(m => m.filter(u => (u.id || u.userId) !== userId))
  }

  async function banMember(userId) {
    await post(`/api/servers/${serverId}/ban/${userId}`, { json: { reason: 'Бан администратором' } })
    setMembers(m => m.filter(u => (u.id || u.userId) !== userId))
  }

  async function unbanMember(userId) {
    await del(`/api/servers/${serverId}/ban/${userId}`)
    setBans(b => b.filter(u => (u.id || u.userId) !== userId))
  }

  async function createChannel() {
    if (!newChanName.trim()) return
    await post(`/api/servers/${serverId}/channels`, { json: { name: newChanName, type: newChanType } })
    setNewChanName('')
    useStore.getState().addToast({ title: 'Канал создан', type: 'success' })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.manageModal} onClick={e => e.stopPropagation()}>
        <div className={styles.manageHeader}>
          <span>Управление: {server?.name}</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className={styles.manageTabs}>
          {['general','channels','members','bans'].map(t => (
            <button key={t} className={`${styles.manageTab} ${tab === t ? styles.manageTabActive : ''}`}
              onClick={() => setTab(t)}>
              {{ general: 'Общее', channels: 'Каналы', members: 'Участники', bans: 'Баны' }[t]}
            </button>
          ))}
        </div>
        <div className={styles.manageBody}>
          {tab === 'general' && (
            <div className={styles.section}>
              <label className={styles.label}>Название</label>
              <input className={styles.input} value={name} onChange={e => setName(e.target.value)} />
              <label className={styles.label}>Описание</label>
              <textarea className={styles.textarea} value={desc} onChange={e => setDesc(e.target.value)} rows={3} />
              <label className={styles.checkRow}>
                <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                Публичный сервер
              </label>
              <button className={styles.saveBtn} onClick={saveGeneral}>Сохранить</button>
            </div>
          )}
          {tab === 'channels' && (
            <div className={styles.section}>
              <label className={styles.label}>Создать канал</label>
              <div className={styles.row}>
                <input className={styles.input} placeholder="Название канала"
                  value={newChanName} onChange={e => setNewChanName(e.target.value)} />
                <select className={styles.select} value={newChanType} onChange={e => setNewChanType(e.target.value)}>
                  <option value="text">Текст</option>
                  <option value="voice">Голос</option>
                </select>
                <button className={styles.saveBtn} onClick={createChannel}>+</button>
              </div>
            </div>
          )}
          {tab === 'members' && (
            <div className={styles.memberList}>
              {members.map(m => (
                <div key={m.id || m.userId} className={styles.memberRow}>
                  <Avatar name={m.displayName || m.username} size={30} />
                  <span className={styles.memberName2}>{m.displayName || m.username}</span>
                  <button className={styles.kickBtn} onClick={() => kickMember(m.id || m.userId)}>Кик</button>
                  <button className={styles.banBtn} onClick={() => banMember(m.id || m.userId)}>Бан</button>
                </div>
              ))}
            </div>
          )}
          {tab === 'bans' && (
            <div className={styles.memberList}>
              {bans.length === 0 && <div className={styles.empty}>Нет забаненных</div>}
              {bans.map(u => (
                <div key={u.id || u.userId} className={styles.memberRow}>
                  <Avatar name={u.displayName || u.username} size={30} />
                  <span className={styles.memberName2}>{u.displayName || u.username}</span>
                  <button className={styles.saveBtn} onClick={() => unbanMember(u.id || u.userId)}>Разбанить</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}
