import React, { useEffect, useRef, useState, useCallback } from 'react'
import useStore from '../../store/useStore'
import { get, post, del, patch } from '../../lib/api'
import { callManager } from '../../lib/webrtc'
import Avatar from '../Avatar'
import StickerPackPopup from '../StickerPackPopup'
import styles from './ChatView.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

// ─── Emoji data ───────────────────────────────────────────────────────────────
const EMOJI_CATS = [
  { id: 'smile',  icon: '😊', name: 'Смайлики', list: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  { id: 'hand',   icon: '👋', name: 'Жесты',    list: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','👃','👀','👅','👄','🫀','🧠','🦷','🦴'] },
  { id: 'people', icon: '👤', name: 'Люди',     list: ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','💂','👷','🤴','👸','👳','👲','🧙','🧝','🧛','🧟','🧞','🧜','🧚','👼','🎅','🤶','🦸','🦹','👫','👬','👭','💑','💏','👪','🧑‍💻','👨‍💻','👩‍💻','🧑‍🎨','🧑‍🚀','🧑‍⚕️'] },
  { id: 'animal', icon: '🐱', name: 'Животные', list: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🦂','🐢','🐍','🦎','🦈','🐬','🐳','🦭','🐊','🐅','🐆','🦓','🦍','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🦔','🐿️'] },
  { id: 'food',   icon: '🍕', name: 'Еда',      list: ['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🫒','🥑','🍆','🥦','🥬','🌽','🌶️','🥔','🍠','🥐','🥖','🫓','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🌮','🌯','🥙','🧆','🍱','🍣','🍤','🍜','🍛','🍝','🍚','🍙','🍘','🍡','🥟','🥠','🥡','🦞','🦐','🦑','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','🍯','☕','🍵','🧃','🥤','🧋','🍺','🍷','🥂','🍸','🍹','🧉','🥃','🍾'] },
  { id: 'travel', icon: '✈️', name: 'Места',    list: ['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','✈️','🛫','🛬','🚀','🛸','🚁','🛶','⛵','🚢','⚓','🏔️','🌋','🏕️','🏖️','🏜️','🏝️','🏟️','🏛️','🏗️','🏘️','🏠','🏡','🏢','🏥','🏦','🏩','🏪','🏫','🏬','🏯','🏰','🗼','🗽','⛪','🕌','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌉','🗺️'] },
  { id: 'sport',  icon: '⚽', name: 'Спорт',    list: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥊','🥋','🎯','⛳','🎣','🤿','🎽','🎿','🛷','🥌','🏆','🥇','🥈','🥉','🏅','🎖️','🏋️','🤸','🤼','⛹️','🤾','🏌️','🏇','🧘','🏄','🚣','🧗','🏊','🚵','🚴','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎹','🥁','🎷','🎺','🎸','🎻','🎲','♟️','🎮','🕹️','🎰','🧩'] },
  { id: 'object', icon: '💡', name: 'Объекты',  list: ['💌','💰','💳','💎','⚖️','🔧','🔨','🛠️','🔩','🔗','🔒','🔓','🔑','🧲','🔦','💡','🔋','📱','💻','🖥️','⌨️','🖱️','📷','📸','📹','🎥','📞','☎️','📺','📻','🧭','⏰','⌚','🔬','🔭','📡','💊','🩺','🩹','🛒','🚪','🪞','🛋️','🛁','🪒','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🧽','🛒','🔑','🗝️','💣','🪤','🧸','🪆','🖼️','🪑','🚿','🛗'] },
  { id: 'symbol', icon: '❤️', name: 'Символы',  list: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','✨','🌟','💫','⭐','🌈','⚡','❄️','🔥','🌊','💥','🎉','🎊','🎈','🎀','🎁','🎗️','✅','❌','⭕','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','💯','🆘','🔞','📵','🚫','🔔','🔕','📣','📢','💬','💭','🗯️','💤','♾️','🔃','🔄','🔙','🔛','🔝'] },
]

const REACTION_EMOJI = ['👍','❤️','😂','😮','😢','😡','🔥','🎉','💯','👏','🤔','😍']

function fullUrl(url) {
  if (!url) return ''
  return url.startsWith('http') ? url : BASE_URL + url
}

export default function ChatView({ getWs, onStickerPackAdded }) {
  const { me, conversations, activeConvId, messages, setMessages, typing, myStickers } = useStore()

  const conv = conversations.find(c => c.id === activeConvId)
  const msgs = messages[activeConvId] || []
  const typingUsers = typing[activeConvId] || []

  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editingMsg, setEditingMsg] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null)
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState(null)
  const [showEmojiPanel, setShowEmojiPanel] = useState(false)
  const [showStickerPanel, setShowStickerPanel] = useState(false)
  const [stickerPopupSlug, setStickerPopupSlug] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [pinned, setPinned] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const typingTimeout = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingTimerRef = useRef(null)

  const otherUser = conv?.otherUser
  const chatName = otherUser?.displayName || otherUser?.username || conv?.name || 'Чат'
  const streak = conv?.streak || 0

  const wallpaperUrl = me?.wallpaper ? fullUrl(me.wallpaper) : null
  const otherAvatarUrl = otherUser?.avatar ? fullUrl(otherUser.avatar) : null

  // Collect all media messages for lightbox navigation
  const mediaMessages = msgs.filter(m => (m.type === 'image' || m.type === 'video') && m.fileUrl && !m.deleted)

  useEffect(() => {
    if (!activeConvId) return
    loadHistory()
    markRead()
  }, [activeConvId])

  useEffect(() => { scrollToBottom() }, [msgs.length])

  useEffect(() => {
    const handler = () => { setCtxMenu(null); setEmojiPickerMsgId(null); setShowEmojiPanel(false); setShowStickerPanel(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  async function loadHistory() {
    setLoadingHistory(true)
    const res = await get(`/api/conversations/${activeConvId}/messages`)
    if (res.ok) setMessages(activeConvId, res.data.messages || res.data || [])
    setLoadingHistory(false)
  }

  async function markRead() {
    await post(`/api/conversations/${activeConvId}/read`)
  }

  function scrollToBottom(force = false) {
    bottomRef.current?.scrollIntoView({ behavior: force ? 'auto' : 'smooth' })
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
    if (!content) return
    const savedReplyTo = replyTo
    setInput('')
    setReplyTo(null)
    const res = await post(`/api/conversations/${activeConvId}/messages`, {
      json: { content, replyTo: savedReplyTo?.id }
    })
    if (res.ok) {
      const msg = res.data.message || res.data
      if (msg?.id) {
        useStore.getState().appendMessage(activeConvId, msg)
        useStore.getState().updateConvLastMessage(activeConvId, msg)
      }
    }
  }

  async function sendFile(file) {
    if (!file) return
    setUploading(true)
    setUploadProgress(0)

    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    const { token } = useStore.getState()
    xhr.open('POST', `${BASE_URL}/api/conversations/${activeConvId}/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('X-Client-Version', '3.0.0')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100))
    }

    xhr.onload = () => {
      setUploading(false)
      setUploadProgress(0)
      if (xhr.status !== 200) {
        useStore.getState().addToast({ title: 'Ошибка', body: 'Не удалось загрузить файл', type: 'error' })
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setUploadProgress(0)
      useStore.getState().addToast({ title: 'Ошибка', body: 'Сетевая ошибка при загрузке', type: 'error' })
    }
    xhr.send(form)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg'
      const mr = new MediaRecorder(stream, { mimeType })
      recordingChunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(recordingChunksRef.current, { type: mimeType })
        sendVoiceMessage(blob)
      }
      mr.start(100)
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (err) {
      useStore.getState().addToast({ title: 'Микрофон', body: 'Нет доступа к микрофону', type: 'error' })
    }
  }

  function stopRecording() {
    clearInterval(recordingTimerRef.current)
    mediaRecorderRef.current?.stop()
    setRecording(false)
    setRecordingTime(0)
  }

  function cancelRecording() {
    clearInterval(recordingTimerRef.current)
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop())
    }
    setRecording(false)
    setRecordingTime(0)
  }

  async function sendVoiceMessage(blob) {
    const ext = blob.type.includes('ogg') ? '.ogg' : '.webm'
    const filename = `voice_${Date.now()}${ext}`
    const file = new File([blob], filename, { type: blob.type })
    await sendFile(file)
  }

  async function deleteMsg(msgId) {
    await del(`/api/conversations/${activeConvId}/messages/${msgId}`)
    setCtxMenu(null)
  }

  function startEdit(msg) {
    setEditingMsg(msg)
    setEditContent(msg.content || '')
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
    setEmojiPickerMsgId(null)
  }

  async function sendSticker(sticker) {
    setShowStickerPanel(false)
    await post(`/api/conversations/${activeConvId}/messages`, {
      json: {
        type: 'sticker',
        content: sticker.name,
        fileUrl: sticker.fileUrl,
        replyToId: replyTo?.id || null,
      }
    })
    setReplyTo(null)
    scrollToBottom()
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

  function insertEmoji(emoji) {
    const el = inputRef.current
    if (!el) { setInput(s => s + emoji); return }
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = input.slice(0, start) + emoji + input.slice(end)
    setInput(newVal)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
  }

  async function startCall() {
    const ws = getWs()
    if (!ws || !otherUser) return
    const callId = crypto.randomUUID()
    try {
      await callManager.startCall(ws, otherUser.id, callId)
      useStore.getState().setActiveCall({ peerId: otherUser.id, peerName: chatName, callId, state: 'calling' })
    } catch (err) {
      useStore.getState().addToast({ title: 'Звонок', body: err.message || 'Нет доступа к микрофону', type: 'error' })
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleCtxMenu(e, msg) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, msg })
    setEmojiPickerMsgId(null)
    setShowEmojiPanel(false)
  }

  function openLightbox(msg) {
    const idx = mediaMessages.findIndex(m => m.id === msg.id)
    setLightbox({ idx: Math.max(0, idx), messages: mediaMessages })
  }

  const grouped = groupByDate(msgs)

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <Avatar name={chatName} size={36} src={otherAvatarUrl} />
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
      <div className={styles.messages} style={wallpaperUrl ? {
        backgroundImage: `url(${wallpaperUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      } : undefined}>
        {loadingHistory && <div className={styles.loading}><span className={styles.loadDots}><span/><span/><span/></span></div>}
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
                emojiPickerMsgId={emojiPickerMsgId}
                setEmojiPickerMsgId={setEmojiPickerMsgId}
                onOpenMedia={() => openLightbox(msg)}
                onStickerPackLink={slug => setStickerPopupSlug(slug)}
              />
            ))}
          </React.Fragment>
        ))}
        {typingUsers.length > 0 && (
          <div className={styles.typing}>
            <span className={styles.typingDots}><span/><span/><span/></span>
            <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'печатает...' : 'печатают...'}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Upload progress bar */}
      {uploading && (
        <div className={styles.uploadBar}>
          <div className={styles.uploadBarInner} style={{ width: `${uploadProgress}%` }} />
          <span className={styles.uploadLabel}>Загрузка... {uploadProgress}%</span>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && !editingMsg && (
        <div className={styles.replyBar}>
          <div className={styles.replyInfo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>
            </svg>
            <span className={styles.replyName}>{replyTo.sender?.displayName || replyTo.sender?.username}:</span>
            <span>{replyTo.type === 'audio' ? '🎤 Голосовое' : replyTo.type === 'image' ? '🖼 Фото' : replyTo.type === 'video' ? '🎬 Видео' : replyTo.content}</span>
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
            <span>Редактирование сообщения</span>
          </div>
          <button onClick={() => setEditingMsg(null)}>✕</button>
        </div>
      )}

      {/* Recording bar */}
      {recording && (
        <div className={styles.recordingBar}>
          <div className={styles.recDot} />
          <span className={styles.recTime}>{fmtTime2(recordingTime)}</span>
          <span className={styles.recLabel}>Запись голосового...</span>
          <div className={styles.recActions}>
            <button className={styles.recCancel} onClick={cancelRecording} title="Отмена">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <button className={styles.recSend} onClick={stopRecording} title="Отправить">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Emoji / GIF panel */}
      {showEmojiPanel && (
        <EmojiGifPanel
          onEmojiSelect={emoji => { insertEmoji(emoji); setShowEmojiPanel(false) }}
          onGifSelect={async (gifUrl) => {
            setShowEmojiPanel(false)
            try {
              const resp = await fetch(gifUrl)
              const blob = await resp.blob()
              const file = new File([blob], `gif_${Date.now()}.gif`, { type: 'image/gif' })
              await sendFile(file)
            } catch {
              useStore.getState().addToast({ title: 'GIF', body: 'Не удалось загрузить GIF', type: 'error' })
            }
          }}
          onClose={() => setShowEmojiPanel(false)}
        />
      )}

      {/* Sticker panel */}
      {showStickerPanel && (
        <StickerPanel
          packs={myStickers}
          onSend={sendSticker}
          onClose={() => setShowStickerPanel(false)}
        />
      )}

      {/* Input area */}
      <div className={styles.inputArea}>
        <button className={styles.attachBtn} onClick={() => fileRef.current?.click()} title="Прикрепить файл" disabled={recording}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip,.txt"
          onChange={e => { sendFile(e.target.files[0]); e.target.value = '' }}
        />

        <button
          className={`${styles.emojiBtn} ${showEmojiPanel ? styles.emojiBtnActive : ''}`}
          onClick={e => { e.stopPropagation(); setShowEmojiPanel(v => !v); setShowStickerPanel(false) }}
          title="Эмодзи / GIF"
          disabled={recording}
        >
          😊
        </button>

        <button
          className={`${styles.emojiBtn} ${showStickerPanel ? styles.emojiBtnActive : ''}`}
          onClick={e => { e.stopPropagation(); setShowStickerPanel(v => !v); setShowEmojiPanel(false) }}
          title="Стикеры"
          disabled={recording}
          style={{ fontSize: 18 }}
        >
          🏷️
        </button>

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
            <button className={`${styles.sendBtn} ${styles.sendActive}`} onClick={submitEdit}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className={styles.input}
              placeholder={recording ? '' : 'Сообщение...'}
              value={input}
              onChange={e => { setInput(e.target.value); handleTyping() }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={recording}
            />
            {input.trim() ? (
              <button className={`${styles.sendBtn} ${styles.sendActive}`} onClick={sendMessage}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            ) : (
              <button
                className={`${styles.micBtn} ${recording ? styles.micActive : ''}`}
                onClick={recording ? stopRecording : startRecording}
                title={recording ? 'Отправить' : 'Голосовое сообщение'}
              >
                {recording
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
                }
              </button>
            )}
          </>
        )}
      </div>

      {/* Sticker pack popup */}
      {stickerPopupSlug && (
        <StickerPackPopup
          slug={stickerPopupSlug}
          onClose={() => setStickerPopupSlug(null)}
          onAddPack={() => { onStickerPackAdded && onStickerPackAdded(); setStickerPopupSlug(null) }}
        />
      )}

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
          onCopy={() => { navigator.clipboard.writeText(ctxMenu.msg.content || ''); setCtxMenu(null) }}
        />
      )}

      {/* Pinned */}
      {pinnedOpen && (
        <PinnedPanel messages={pinned} onClose={() => setPinnedOpen(false)} />
      )}

      {/* Lightbox */}
      {lightbox && (
        <MediaLightbox
          messages={lightbox.messages}
          idx={lightbox.idx}
          onClose={() => setLightbox(null)}
          onNav={(idx) => setLightbox(l => ({ ...l, idx }))}
        />
      )}
    </div>
  )
}

// ─── StickerPanel ───────────────────────────────────────────────────────────────
function StickerPanel({ packs, onSend, onClose }) {
  const [activePack, setActivePack] = useState(packs?.[0]?.id || null)
  const currentPack = packs?.find(p => p.id === activePack)

  if (!packs || packs.length === 0) {
    return (
      <div className={styles.emojiPanel} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text2)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
          <div style={{ fontSize: 13 }}>Нет стикеров</div>
          <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text3)' }}>Добавьте паки в Creator Studio</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.emojiPanel} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '4px 8px', gap: 4, overflowX: 'auto' }}>
        {packs.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePack(p.id)}
            style={{
              padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
              background: activePack === p.id ? 'var(--accent)' : 'var(--bg3)',
              color: activePack === p.id ? '#fff' : 'var(--text2)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '10px', overflowY: 'auto', maxHeight: 220 }}>
        {currentPack?.stickers?.map(s => (
          <button
            key={s.id}
            onClick={() => onSend(s)}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, cursor: 'pointer', transition: '0.15s' }}
            onMouseOver={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <img src={fullUrl(s.fileUrl)} alt={s.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', display: 'block' }} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────
const OM_LINK_RE = /Om\.org\/([a-z0-9_-]+)/gi

function detectOmLinks(text, onStickerPackLink) {
  if (!text || !onStickerPackLink) return <span className={styles.msgContent}>{text}</span>
  const parts = []
  let last = 0
  const regex = /Om\.org\/([a-z0-9_-]+)/gi
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const slug = match[1]
    parts.push(
      <button
        key={match.index}
        onClick={e => { e.stopPropagation(); onStickerPackLink(slug) }}
        style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', font: 'inherit', padding: 0 }}
      >
        {match[0]}
      </button>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className={styles.msgContent}>{parts}</span>
}

function MessageBubble({ msg, isMe, onCtxMenu, onReact, showAvatar, emojiPickerMsgId, setEmojiPickerMsgId, onOpenMedia, onStickerPackLink }) {
  const senderName = msg.sender?.displayName || msg.sender?.username || 'Неизвестно'
  const time = fmtTime(msg.createdAt)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0

  return (
    <div
      className={`${styles.msgRow} ${isMe ? styles.msgRowMe : ''}`}
      onContextMenu={e => onCtxMenu(e, msg)}
    >
      {!isMe && (
        <div className={styles.msgAvatar}>
          {showAvatar ? <Avatar name={senderName} size={32} /> : <div style={{ width: 32 }} />}
        </div>
      )}
      <div className={styles.msgBubbleWrap}>
        {!isMe && showAvatar && <span className={styles.msgSender}>{senderName}</span>}

        {msg.replyTo && (
          <div className={styles.msgReply}>
            <span className={styles.replyName2}>{msg.replyTo.sender?.username}:</span>
            <span>{msg.replyTo.content || (msg.replyTo.type === 'audio' ? '🎤 Голосовое' : '📎 Файл')}</span>
          </div>
        )}

        <div className={`${styles.msgBubble} ${isMe ? styles.msgBubbleMe : styles.msgBubbleThem} ${msg.type === 'image' || msg.type === 'video' ? styles.msgBubbleMedia : ''}`}>
          {msg.deleted || msg.deletedForAll ? (
            <span className={styles.msgDeleted}>🗑 Сообщение удалено</span>
          ) : (
            <>
              {msg.type === 'image' && msg.fileUrl && (
                <ImageAttachment url={msg.fileUrl} name={msg.fileName} onClick={onOpenMedia} />
              )}
              {msg.type === 'video' && msg.fileUrl && (
                <VideoAttachment url={msg.fileUrl} name={msg.fileName} />
              )}
              {msg.type === 'audio' && msg.fileUrl && (
                <VoiceBubble url={msg.fileUrl} duration={msg.fileDuration} isMe={isMe} />
              )}
              {msg.type === 'file' && msg.fileUrl && (
                <FileAttachment url={msg.fileUrl} name={msg.fileName} size={msg.fileSize} />
              )}
              {msg.type === 'sticker' && msg.fileUrl && (
                <div className={styles.stickerMsg}>
                  <img src={fullUrl(msg.fileUrl)} alt={msg.content || 'Стикер'} loading="lazy" />
                </div>
              )}
              {(!msg.type || msg.type === 'text') && msg.content && (
                detectOmLinks(msg.content, onStickerPackLink)
              )}
              {msg.type === 'text' && msg.fileUrl && (
                <FileAttachment url={msg.fileUrl} name={msg.fileName} size={msg.fileSize} />
              )}
              {msg.edited && <span className={styles.msgEdited}> ✏</span>}
            </>
          )}
        </div>

        {hasReactions && (
          <div className={styles.reactions}>
            {Object.entries(msg.reactions).map(([emoji, count]) => (
              <button key={emoji} className={styles.reactionBtn} onClick={() => onReact(emoji)}>
                {emoji} <span>{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.msgMeta}>
          <span className={styles.msgTime}>{time}</span>
          <button
            className={styles.emojiTrigger}
            onClick={e => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id) }}
          >😊</button>
        </div>

        {emojiPickerMsgId === msg.id && (
          <div className={`${styles.reactionPicker} ${isMe ? styles.reactionPickerMe : ''}`} onClick={e => e.stopPropagation()}>
            {REACTION_EMOJI.map(e => (
              <button key={e} className={styles.reactionPickerBtn} onClick={() => onReact(e)}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ImageAttachment ────────────────────────────────────────────────────────────
function ImageAttachment({ url, name, onClick }) {
  const [loaded, setLoaded] = useState(false)
  const src = fullUrl(url)
  return (
    <div className={styles.imgWrap} onClick={onClick}>
      {!loaded && <div className={styles.imgSkeleton} />}
      <img
        src={src}
        alt={name || 'Фото'}
        className={`${styles.imgAttach} ${loaded ? styles.imgLoaded : ''}`}
        onLoad={() => setLoaded(true)}
        loading="lazy"
      />
      <div className={styles.imgOverlay}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </div>
    </div>
  )
}

// ─── VideoAttachment ────────────────────────────────────────────────────────────
function VideoAttachment({ url, name }) {
  const src = fullUrl(url)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef(null)

  function toggle() {
    if (!videoRef.current) return
    if (playing) { videoRef.current.pause(); setPlaying(false) }
    else { videoRef.current.play(); setPlaying(true) }
  }

  return (
    <div className={styles.videoWrap}>
      <video
        ref={videoRef}
        src={src}
        className={styles.videoAttach}
        onEnded={() => setPlaying(false)}
        controls={false}
        playsInline
        preload="metadata"
      />
      <div className={`${styles.videoOverlay} ${playing ? styles.videoPlaying : ''}`} onClick={toggle}>
        {!playing && (
          <div className={styles.playBtn}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
        )}
      </div>
      {name && <div className={styles.videoName}>{name}</div>}
      <div className={styles.videoControls}>
        <button className={styles.videoCtrlBtn} onClick={toggle}>
          {playing
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          }
        </button>
        <a
          href={src}
          download={name || 'video'}
          className={styles.videoCtrlBtn}
          onClick={e => e.stopPropagation()}
          title="Скачать"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      </div>
    </div>
  )
}

// ─── VoiceBubble ────────────────────────────────────────────────────────────────
function VoiceBubble({ url, isMe }) {
  const src = fullUrl(url)
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onMeta = () => setDuration(audio.duration || 0)
    const onTime = () => { setCurrentTime(audio.currentTime); setProgress((audio.currentTime / (audio.duration || 1)) * 100) }
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); audio.currentTime = 0 }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)
    return () => { audio.removeEventListener('loadedmetadata', onMeta); audio.removeEventListener('timeupdate', onTime); audio.removeEventListener('ended', onEnd) }
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { audio.play(); setPlaying(true) }
  }

  function seek(e) {
    const audio = audioRef.current
    if (!audio) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * (audio.duration || 0)
  }

  return (
    <div className={`${styles.voiceBubble} ${isMe ? styles.voiceBubbleMe : ''}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button className={styles.voicePlayBtn} onClick={toggle}>
        {playing
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        }
      </button>
      <div className={styles.voiceTrack} onClick={seek}>
        <div className={styles.voiceBar}>
          <div className={styles.voiceProgress} style={{ width: `${progress}%` }} />
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className={styles.voiceWave} style={{ height: `${30 + Math.sin(i * 0.7) * 20 + Math.random() * 15}%`, opacity: i / 30 <= progress / 100 ? 1 : 0.35 }} />
          ))}
        </div>
        <span className={styles.voiceTime}>{fmtTime2(playing ? Math.floor(currentTime) : Math.floor(duration))}</span>
      </div>
      <span className={styles.voiceIcon}>🎤</span>
    </div>
  )
}

// ─── FileAttachment ────────────────────────────────────────────────────────────
function FileAttachment({ url, name, size }) {
  const src = fullUrl(url)
  const ext = (name || url || '').split('.').pop()?.toUpperCase() || 'FILE'
  const sizeStr = size ? (size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} МБ` : `${(size / 1024).toFixed(0)} КБ`) : ''

  return (
    <a className={styles.fileAttach} href={src} target="_blank" rel="noreferrer" download={name} onClick={e => e.stopPropagation()}>
      <div className={styles.fileIcon}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span className={styles.fileExt}>{ext.slice(0, 4)}</span>
      </div>
      <div className={styles.fileInfo}>
        <span className={styles.fileName}>{name || 'Файл'}</span>
        <span className={styles.fileSize}>{sizeStr}</span>
      </div>
      <div className={styles.fileDown}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
    </a>
  )
}

// ─── EmojiGifPanel ─────────────────────────────────────────────────────────────
function EmojiGifPanel({ onEmojiSelect, onGifSelect, onClose }) {
  const [tab, setTab] = useState('emoji')
  const [emojiCat, setEmojiCat] = useState(0)
  const [gifQuery, setGifQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [gifLoading, setGifLoading] = useState(false)
  const searchTimeout = useRef(null)

  async function searchGifs(q) {
    if (!q.trim()) { setGifs([]); return }
    setGifLoading(true)
    try {
      const url = `https://api.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=LIVDSRZULELA&limit=20&media_filter=minimal&contentfilter=medium`
      const r = await fetch(url)
      const data = await r.json()
      setGifs(data.results || [])
    } catch { setGifs([]) }
    setGifLoading(false)
  }

  function onGifQueryChange(e) {
    const q = e.target.value
    setGifQuery(q)
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => searchGifs(q), 500)
  }

  useEffect(() => {
    if (tab === 'gif' && !gifQuery) searchGifs('привет')
  }, [tab])

  return (
    <div className={styles.emojiPanel} onClick={e => e.stopPropagation()}>
      <div className={styles.emojiPanelTabs}>
        <button className={`${styles.emojiTab} ${tab === 'emoji' ? styles.emojiTabActive : ''}`} onClick={() => setTab('emoji')}>😊 Emoji</button>
        <button className={`${styles.emojiTab} ${tab === 'gif' ? styles.emojiTabActive : ''}`} onClick={() => setTab('gif')}>GIF</button>
      </div>

      {tab === 'emoji' && (
        <>
          <div className={styles.emojiCats}>
            {EMOJI_CATS.map((cat, i) => (
              <button key={cat.id} className={`${styles.emojiCatBtn} ${emojiCat === i ? styles.emojiCatActive : ''}`} onClick={() => setEmojiCat(i)} title={cat.name}>
                {cat.icon}
              </button>
            ))}
          </div>
          <div className={styles.emojiGrid}>
            {EMOJI_CATS[emojiCat].list.map((e, i) => (
              <button key={i} className={styles.emojiItem} onClick={() => onEmojiSelect(e)}>{e}</button>
            ))}
          </div>
        </>
      )}

      {tab === 'gif' && (
        <>
          <div className={styles.gifSearch}>
            <input
              type="text"
              placeholder="Поиск GIF..."
              value={gifQuery}
              onChange={onGifQueryChange}
              className={styles.gifSearchInput}
              autoFocus
            />
          </div>
          <div className={styles.gifGrid}>
            {gifLoading && <div className={styles.gifLoading}>Поиск...</div>}
            {!gifLoading && gifs.map(gif => {
              const media = gif.media?.[0]
              const url = media?.gif?.url || media?.mediumgif?.url || media?.tinygif?.url
              const gifUrl = gif.url
              if (!url) return null
              return (
                <button key={gif.id} className={styles.gifItem} onClick={() => onGifSelect(url)}>
                  <img src={media?.tinygif?.url || url} alt={gif.title} loading="lazy" />
                </button>
              )
            })}
            {!gifLoading && gifs.length === 0 && gifQuery && (
              <div className={styles.gifLoading}>Ничего не найдено</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── MediaLightbox ──────────────────────────────────────────────────────────────
function MediaLightbox({ messages, idx, onClose, onNav }) {
  const msg = messages[idx]
  if (!msg) return null
  const src = fullUrl(msg.fileUrl)
  const isVideo = msg.type === 'video'
  const hasPrev = idx > 0
  const hasNext = idx < messages.length - 1

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && hasPrev) onNav(idx - 1)
      if (e.key === 'ArrowRight' && hasNext) onNav(idx + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [idx, hasPrev, hasNext])

  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <div className={styles.lightboxHeader} onClick={e => e.stopPropagation()}>
        <span className={styles.lightboxName}>{msg.fileName || (isVideo ? 'Видео' : 'Фото')}</span>
        <div className={styles.lightboxActions}>
          <a
            href={src}
            download={msg.fileName || 'media'}
            className={styles.lightboxBtn}
            onClick={e => e.stopPropagation()}
            title="Скачать"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          <button className={styles.lightboxBtn} onClick={onClose} title="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.lightboxContent} onClick={e => e.stopPropagation()}>
        {hasPrev && (
          <button className={`${styles.lightboxNav} ${styles.lightboxPrev}`} onClick={() => onNav(idx - 1)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        {isVideo
          ? <video src={src} className={styles.lightboxMedia} controls autoPlay playsInline />
          : <img src={src} alt={msg.fileName} className={styles.lightboxMedia} />
        }
        {hasNext && (
          <button className={`${styles.lightboxNav} ${styles.lightboxNext}`} onClick={() => onNav(idx + 1)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}
      </div>

      <div className={styles.lightboxFooter} onClick={e => e.stopPropagation()}>
        <span>{idx + 1} / {messages.length}</span>
        <span className={styles.lightboxSender}>{msg.sender?.displayName || msg.sender?.username}</span>
        <span>{fmtTime(msg.createdAt)}</span>
      </div>
    </div>
  )
}

// ─── ContextMenu ───────────────────────────────────────────────────────────────
function ContextMenu({ x, y, msg, isMe, onClose, onReply, onEdit, onDelete, onPin, onCopy }) {
  const style = {
    top: Math.min(y, window.innerHeight - 240),
    left: Math.min(x, window.innerWidth - 180),
  }
  return (
    <div className={styles.ctxMenu} style={style} onClick={e => e.stopPropagation()}>
      <button onClick={onReply}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
        Ответить
      </button>
      {msg.content && (
        <button onClick={onCopy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Копировать
        </button>
      )}
      {isMe && msg.type !== 'audio' && (
        <button onClick={onEdit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Редактировать
        </button>
      )}
      <button onClick={onPin}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        Закрепить
      </button>
      {isMe && <button className={styles.ctxDanger} onClick={onDelete}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        Удалить
      </button>}
    </div>
  )
}

// ─── PinnedPanel ───────────────────────────────────────────────────────────────
function PinnedPanel({ messages, onClose }) {
  return (
    <div className={styles.pinnedPanel}>
      <div className={styles.pinnedHeader}>
        <span>📌 Закреплённые ({messages.length})</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className={styles.pinnedList}>
        {messages.length === 0 && <div className={styles.pinnedEmpty}>Нет закреплённых сообщений</div>}
        {messages.map(m => (
          <div key={m.id} className={styles.pinnedMsg}>
            <span className={styles.pinnedSender}>{m.sender?.username}:</span>
            <span className={styles.pinnedContent}>{m.type === 'image' ? '🖼 Фото' : m.type === 'video' ? '🎬 Видео' : m.type === 'audio' ? '🎤 Голосовое' : m.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Utils ─────────────────────────────────────────────────────────────────────
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
  try { return new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function fmtTime2(s) {
  const m = Math.floor((s || 0) / 60).toString().padStart(2, '0')
  const sec = ((s || 0) % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

function fmtDay(ts) {
  try {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return 'Сегодня'
    const y = new Date(now); y.setDate(now.getDate() - 1)
    if (d.toDateString() === y.toDateString()) return 'Вчера'
    return d.toLocaleDateString('ru', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return '' }
}
