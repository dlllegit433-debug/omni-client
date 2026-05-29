import React, { useEffect, useRef, useState, useCallback } from 'react'
import useStore from '../../store/useStore'
import { get, post, del, patch } from '../../lib/api'
import { AudioCall as AudioCallClass } from '../../lib/audio'
import Avatar from '../Avatar'
import styles from './ChatView.module.css'

const EMOJI_LIST = ['👍','❤️','😂','😮','😢','😡','🔥','🎉','💯','👏','🤔','😍']

export default function ChatView({ getWs }) {
  const { me, conversations, activeConvId, messages, setMessages,
    typing, setActiveConv } = useStore()

  const conv = conversations.find(c => c.id === activeConvId)
  const msgs = messages[activeConvId] || []
  const typingUsers = typing[activeConvId] || []

  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editingMsg, setEditingMsg] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null)
  const [emojiPicker, setEmojiPicker] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [pinned, setPinned] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const typingTimeout = useRef(null)

  const otherUser = conv?.otherUser
  const chatName = otherUser?.displayName || otherUser?.username || conv?.name || 'Чат'
  const streak = conv?.streak || 0

  useEffect(() => {
    if (!activeConvId) return
    loadHistory()
    markRead()
  }, [activeConvId])

  useEffect(() => {
    scrollToBottom()
  }, [msgs.length])

  async function loadHistory() {
    setLoadingHistory(true)
    const res = await get(`/api/conversations/${activeConvId}/messages`)
    if (res.ok) {
      setMessages(activeConvId, res.data.messages || res.data || [])
    }
    setLoadingHistory(false)
  }

  async function markRead() {
    await post(`/api/conversations/${activeConvId}/read`)
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleTyping() {
    const ws = getWs()
    if (!ws) return
    ws.send({ type: 'typing', conversationId: activeConvId })
    clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => {}, 3000)
  }

  async function sendMessage() {
    const content = input.trim()
    if (!content && !uploading) return
    const savedReplyTo = replyTo
    setInput('')
    setReplyTo(null)

    const res = await post(`/api/conversations/${activeConvId}/messages`, {
      json: { content, replyTo: savedReplyTo?.id }
    })
    if (res.ok) {
      const msg = res.data.message || res.data
      if (msg && msg.id) {
        useStore.getState().appendMessage(activeConvId, msg)
        useStore.getState().updateConvLastMessage(activeConvId, msg)
      }
    }
  }

  async function sendFile(file) {
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('conversationId', activeConvId)
    const res = await post('/api/upload', { form })
    setUploading(false)
    if (res.ok) {
      await post(`/api/conversations/${activeConvId}/messages`, {
        json: { content: '', fileUrl: res.data.url, fileName: file.name }
      })
    } else {
      useStore.getState().addToast({ title: 'Ошибка', body: 'Не удалось загрузить файл', type: 'error' })
    }
  }

  async function deleteMsg(msgId) {
    await del(`/api/conversations/${activeConvId}/messages/${msgId}`)
    setCtxMenu(null)
  }

  async function startEdit(msg) {
    setEditingMsg(msg)
    setEditContent(msg.content)
    setCtxMenu(null)
  }

  async function submitEdit() {
    if (!editingMsg) return
    await patch(`/api/conversations/${activeConvId}/messages/${editingMsg.id}`, {
      json: { content: editContent }
    })
    setEditingMsg(null)
    setEditContent('')
  }

  async function sendReaction(msgId, emoji) {
    await post(`/api/conversations/${activeConvId}/messages/${msgId}/react`, {
      json: { emoji }
    })
    setEmojiPicker(null)
  }

  async function pinMessage(msgId) {
    await post(`/api/conversations/${activeConvId}/pin/${msgId}`)
    setCtxMenu(null)
  }

  async function loadPinned() {
    const res = await get(`/api/conversations/${activeConvId}/pinned`)
    if (res.ok) setPinned(res.data.messages || res.data || [])
    setPinnedOpen(true)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleCtxMenu(e, msg) {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, msg })
  }

  function startCall() {
    const ws = getWs()
    if (!ws || !otherUser) return
    const callId = crypto.randomUUID()
    const audio = new AudioCallClass({ ws, peerId: otherUser.id, callId })
    ws.send({ type: 'call_offer', targetUserId: otherUser.id, callId, offer: {} })
    useStore.getState().setActiveCall({ peerId: otherUser.id, peerName: chatName, callId, state: 'calling', audio })
    audio.start().catch(err => {
      useStore.getState().addToast({ title: 'Звонок', body: err.message, type: 'error' })
    })
  }

  // Group messages by date
  const grouped = groupByDate(msgs)

  return (
    <div className={styles.root} onClick={() => { setCtxMenu(null); setEmojiPicker(null) }}>
      {/* Header */}
      <div className={styles.header}>
        <Avatar name={chatName} size={36} />
        <div className={styles.headerInfo}>
          <span className={styles.headerName}>{chatName}</span>
          {streak > 0 && <span className={styles.streak}>🔥 {streak}</span>}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.hBtn} onClick={loadPinned} title="Закреплённые">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          {otherUser && (
            <button className={styles.hBtn} onClick={startCall} title="Позвонить">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.59 10.59 19.79 19.79 0 01.5 2a2 2 0 012-2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.6 7.84a16 16 0 006.59 6.59l1.18-1.18a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className={styles.messages}>
        {loadingHistory && <div className={styles.loading}>Загрузка...</div>}
        {grouped.map(({ date, messages: dayMsgs }) => (
          <React.Fragment key={date}>
            <div className={styles.dateSep}><span>{date}</span></div>
            {dayMsgs.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isMe={msg.sender?.id === me?.id || msg.senderId === me?.id}
                onCtxMenu={handleCtxMenu}
                onReact={(emoji) => sendReaction(msg.id, emoji)}
                showAvatar={i === 0 || dayMsgs[i-1]?.sender?.id !== msg.sender?.id}
                emojiPicker={emojiPicker}
                setEmojiPicker={setEmojiPicker}
              />
            ))}
          </React.Fragment>
        ))}
        {typingUsers.length > 0 && (
          <div className={styles.typing}>
            <span className={styles.typingDots}><span/><span/><span/></span>
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'печатает...' : 'печатают...'}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      {replyTo && (
        <div className={styles.replyBar}>
          <div className={styles.replyInfo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>
            </svg>
            <span>{replyTo.sender?.displayName || replyTo.sender?.username}: {replyTo.content}</span>
          </div>
          <button onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {/* Edit bar */}
      {editingMsg && (
        <div className={styles.replyBar}>
          <div className={styles.replyInfo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Редактирование
          </div>
          <button onClick={() => setEditingMsg(null)}>✕</button>
        </div>
      )}

      {/* Input area */}
      <div className={styles.inputArea}>
        <button className={styles.attachBtn} onClick={() => fileRef.current?.click()} title="Прикрепить файл">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => sendFile(e.target.files[0])} />

        {editingMsg ? (
          <>
            <textarea
              className={styles.input}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() } }}
              rows={1}
              autoFocus
            />
            <button className={styles.sendBtn} onClick={submitEdit}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" fill="none"/>
              </svg>
            </button>
          </>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className={styles.input}
              placeholder="Сообщение..."
              value={input}
              onChange={e => { setInput(e.target.value); handleTyping() }}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button className={`${styles.sendBtn} ${input.trim() ? styles.sendActive : ''}`}
              onClick={sendMessage} disabled={!input.trim() && !uploading}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y} msg={ctxMenu.msg}
          isMe={ctxMenu.msg.sender?.id === me?.id || ctxMenu.msg.senderId === me?.id}
          onClose={() => setCtxMenu(null)}
          onReply={() => { setReplyTo(ctxMenu.msg); setCtxMenu(null) }}
          onEdit={() => startEdit(ctxMenu.msg)}
          onDelete={() => deleteMsg(ctxMenu.msg.id)}
          onPin={() => pinMessage(ctxMenu.msg.id)}
          onCopy={() => { navigator.clipboard.writeText(ctxMenu.msg.content); setCtxMenu(null) }}
        />
      )}

      {/* Pinned messages */}
      {pinnedOpen && (
        <PinnedPanel messages={pinned} onClose={() => setPinnedOpen(false)} />
      )}
    </div>
  )
}

function MessageBubble({ msg, isMe, onCtxMenu, onReact, showAvatar, emojiPicker, setEmojiPicker }) {
  const senderName = msg.sender?.displayName || msg.sender?.username || 'Неизвестно'
  const time = fmtTime(msg.createdAt)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0

  return (
    <div className={`${styles.msgRow} ${isMe ? styles.msgRowMe : ''}`}
      onContextMenu={e => onCtxMenu(e, msg)}>
      {!isMe && (
        <div className={styles.msgAvatar}>
          {showAvatar ? <Avatar name={senderName} size={32} /> : <div style={{ width: 32 }} />}
        </div>
      )}
      <div className={styles.msgBubbleWrap}>
        {!isMe && showAvatar && (
          <span className={styles.msgSender}>{senderName}</span>
        )}
        {msg.replyTo && (
          <div className={styles.msgReply}>
            <span>{msg.replyTo.sender?.username}: {msg.replyTo.content}</span>
          </div>
        )}
        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem}`}>
          {msg.deleted ? (
            <span className={styles.msgDeleted}>🗑 Сообщение удалено</span>
          ) : (
            <>
              {msg.fileUrl ? (
                <FileAttachment url={msg.fileUrl} name={msg.fileName} />
              ) : (
                <span className={styles.msgContent}>{msg.content}</span>
              )}
              {msg.edited && <span className={styles.msgEdited}> ✏</span>}
            </>
          )}
        </div>
        {hasReactions && (
          <div className={styles.reactions}>
            {Object.entries(msg.reactions).map(([emoji, count]) => (
              <button key={emoji} className={styles.reactionBtn}
                onClick={() => onReact(emoji)}>
                {emoji} {count}
              </button>
            ))}
          </div>
        )}
        <div className={styles.msgMeta}>
          <span className={styles.msgTime}>{time}</span>
          <button className={styles.emojiTrigger}
            onClick={e => { e.stopPropagation(); setEmojiPicker(emojiPicker === msg.id ? null : msg.id) }}>
            😊
          </button>
        </div>
        {emojiPicker === msg.id && (
          <div className={styles.emojiPicker} onClick={e => e.stopPropagation()}>
            {EMOJI_LIST.map(e => (
              <button key={e} className={styles.emojiBtn} onClick={() => onReact(e)}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FileAttachment({ url, name }) {
  const BASE = 'https://omnii.duckdns.org:3000'
  const fullUrl = url.startsWith('http') ? url : BASE + url
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name || url)

  if (isImage) {
    return (
      <img src={fullUrl} alt={name} className={styles.imgAttach}
        onClick={() => window.electron?.openExternal(fullUrl)} />
    )
  }
  return (
    <div className={styles.fileAttach}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>{name || 'Файл'}</span>
      <a href={fullUrl} target="_blank" rel="noreferrer" download>Скачать</a>
    </div>
  )
}

function ContextMenu({ x, y, msg, isMe, onClose, onReply, onEdit, onDelete, onPin, onCopy }) {
  const style = { top: Math.min(y, window.innerHeight - 200), left: Math.min(x, window.innerWidth - 160) }
  return (
    <div className={styles.ctxMenu} style={style} onClick={e => e.stopPropagation()}>
      <button onClick={onReply}>↩ Ответить</button>
      <button onClick={onCopy}>📋 Копировать</button>
      {isMe && <button onClick={onEdit}>✏️ Редактировать</button>}
      <button onClick={onPin}>📌 Закрепить</button>
      {isMe && <button className={styles.ctxDanger} onClick={onDelete}>🗑 Удалить</button>}
    </div>
  )
}

function PinnedPanel({ messages, onClose }) {
  return (
    <div className={styles.pinnedPanel}>
      <div className={styles.pinnedHeader}>
        <span>📌 Закреплённые</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className={styles.pinnedList}>
        {messages.length === 0 && <div className={styles.pinnedEmpty}>Нет закреплённых сообщений</div>}
        {messages.map(m => (
          <div key={m.id} className={styles.pinnedMsg}>
            <span className={styles.pinnedSender}>{m.sender?.username}:</span>
            <span className={styles.pinnedContent}>{m.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function groupByDate(msgs) {
  const groups = {}
  for (const msg of msgs) {
    const d = fmtDay(msg.createdAt)
    if (!groups[d]) groups[d] = []
    groups[d].push(msg)
  }
  return Object.entries(groups).map(([date, messages]) => ({ date, messages }))
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function fmtDay(ts) {
  try {
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return 'Сегодня'
    const y = new Date(now); y.setDate(now.getDate() - 1)
    if (d.toDateString() === y.toDateString()) return 'Вчера'
    return d.toLocaleDateString('ru', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return '' }
}
