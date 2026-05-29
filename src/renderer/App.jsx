import React, { useEffect, useRef } from 'react'
import useStore, { applyTheme } from './store/useStore'
import { get, post } from './lib/api'
import { WSClient } from './lib/ws'
import AuthPage from './pages/AuthPage'
import MainPage from './pages/MainPage'
import ToastContainer from './components/ToastContainer'
import IncomingCallModal from './components/calls/IncomingCallModal'
import ActiveCallWindow from './components/calls/ActiveCallWindow'

let wsInstance = null

export default function App() {
  const { token, me, setAuth, logout, setWsConnected, addToast,
    appendMessage, updateMessage, deleteMessage, updateConvLastMessage,
    incrementUnread, activeConvId, setTyping, setIncomingCall,
    activeCall, setActiveCall, incomingCall, updateMe, conversations,
    appendChannelMessage, activeChannelId } = useStore()

  const wsRef = useRef(null)
  const pingRef = useRef(null)

  useEffect(() => {
    applyTheme('violet')
    // Load saved session
    ;(async () => {
      try {
        const cfg = await window.electron?.config.load() || {}
        if (cfg.token) {
          const res = await get('/api/auth/me', { token: cfg.token })
          if (res.ok) {
            setAuth(cfg.token, res.data)
            applyTheme(res.data.theme || 'violet')
          }
        }
      } catch {}
    })()
  }, [])

  useEffect(() => {
    if (!token) {
      wsInstance?.disconnect()
      wsInstance = null
      wsRef.current = null
      clearInterval(pingRef.current)
      return
    }

    const ws = new WSClient({
      onConnect: () => {
        setWsConnected(true)
      },
      onDisconnect: () => {
        setWsConnected(false)
      },
      onMessage: (msg) => handleWsMessage(msg),
    })
    ws.connect(token)
    wsInstance = ws
    wsRef.current = ws

    pingRef.current = setInterval(() => ws.send({ type: 'ping' }), 30000)

    return () => {
      ws.disconnect()
      clearInterval(pingRef.current)
    }
  }, [token])

  function handleWsMessage(msg) {
    const store = useStore.getState()

    switch (msg.type) {
      case 'new_message': {
        const { conversationId, message } = msg
        store.appendMessage(conversationId, message)
        store.updateConvLastMessage(conversationId, message)
        if (conversationId !== store.activeConvId) {
          store.incrementUnread(conversationId)
          if (message.sender?.id !== store.me?.id) {
            store.addToast({
              title: message.sender?.displayName || message.sender?.username,
              body: message.content,
              type: 'message',
            })
            window.electron?.notify({
              title: message.sender?.displayName || message.sender?.username,
              body: message.content?.slice(0, 80),
            })
          }
        }
        break
      }
      case 'message_edited': {
        const { conversationId, messageId, content } = msg
        store.updateMessage(conversationId, messageId, { content, edited: true })
        break
      }
      case 'message_deleted': {
        const { conversationId, messageId } = msg
        store.deleteMessage(conversationId, messageId)
        break
      }
      case 'message_reaction': {
        const { conversationId, messageId, reactions } = msg
        store.updateMessage(conversationId, messageId, { reactions })
        break
      }
      case 'typing': {
        const { conversationId, username } = msg
        const cur = store.typing[conversationId] || []
        if (!cur.includes(username)) {
          store.setTyping(conversationId, [...cur, username])
          setTimeout(() => {
            const now = useStore.getState().typing[conversationId] || []
            store.setTyping(conversationId, now.filter(u => u !== username))
          }, 3000)
        }
        break
      }
      case 'incoming_call': {
        store.setIncomingCall(msg)
        break
      }
      case 'call_accepted': {
        store.setActiveCall(store.activeCall ? { ...store.activeCall, state: 'connected', startTime: Date.now() } : null)
        break
      }
      case 'call_rejected': {
        store.activeCall?.audio?.stop()
        store.setActiveCall(null)
        store.addToast({ title: 'Звонок', body: 'Собеседник отклонил звонок', type: 'info' })
        break
      }
      case 'call_ended': {
        store.activeCall?.audio?.stop()
        store.setActiveCall(null)
        break
      }
      case 'call_unavailable': {
        store.activeCall?.audio?.stop()
        store.setActiveCall(null)
        store.addToast({ title: 'Звонок', body: 'Пользователь недоступен', type: 'info' })
        break
      }
      case 'call_audio': {
        store.activeCall?.audio?.receive(msg.audio)
        break
      }
      case 'coins_added': {
        store.updateMe({ coins: msg.coins })
        store.addToast({ title: '💰 Монеты', body: `Начислено ${msg.amount} монет`, type: 'success' })
        break
      }
      case 'premium_activated': {
        store.updateMe({ isPremium: true, premiumUntil: msg.until })
        store.addToast({ title: '⭐ Premium', body: 'Premium активирован!', type: 'success' })
        break
      }
      case 'force_logout': {
        store.addToast({ title: 'Сессия завершена', body: msg.reason || '', type: 'error' })
        setTimeout(() => store.logout(), 2000)
        break
      }
      case 'account_frozen': {
        store.addToast({ title: '❄️ Аккаунт заморожен', body: msg.reason || '', type: 'error' })
        setTimeout(() => store.logout(), 3000)
        break
      }
      case 'account_muted': {
        store.addToast({ title: '🔇 Вы замьючены', body: `До ${msg.until || 'снятия'}`, type: 'warning' })
        break
      }
      case 'new_channel_message': {
        const { channelId, message } = msg
        store.appendChannelMessage(channelId, message)
        break
      }
      case 'channel_message_edited': {
        // handled by server panel
        break
      }
    }
  }

  function getWs() { return wsRef.current }

  return (
    <>
      {!token
        ? <AuthPage />
        : <MainPage getWs={getWs} />
      }
      <ToastContainer />
      {incomingCall && <IncomingCallModal call={incomingCall} getWs={getWs} />}
      {activeCall && <ActiveCallWindow getWs={getWs} />}
    </>
  )
}
