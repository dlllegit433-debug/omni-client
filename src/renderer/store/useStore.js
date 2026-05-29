import { create } from 'zustand'
import { setToken } from '../lib/api'

const useStore = create((set, get) => ({
  // Auth
  token: null,
  me: null,
  isAdmin: false,

  setAuth: (token, me) => {
    setToken(token)
    set({ token, me, isAdmin: me?.isAdmin || false })
  },
  updateMe: (fields) => set(s => ({ me: { ...s.me, ...fields } })),
  logout: () => {
    setToken(null)
    set({
      token: null, me: null, isAdmin: false,
      conversations: [], activeConvId: null,
      messages: {}, unread: {},
      servers: [], activeServerId: null, activeChannelId: null,
      channelMessages: {},
    })
  },

  // Connection
  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  // Conversations (DMs + groups)
  conversations: [],
  activeConvId: null,
  messages: {},       // { [convId]: Message[] }
  unread: {},         // { [convId]: number }
  typing: {},         // { [convId]: string[] }

  setConversations: (list) => set({ conversations: list }),
  setActiveConv: (id) => {
    set(s => ({
      activeConvId: id,
      unread: { ...s.unread, [id]: 0 },
      activeServerId: null,
      activeChannelId: null,
    }))
  },

  setMessages: (convId, msgs) => set(s => ({
    messages: { ...s.messages, [convId]: msgs }
  })),
  appendMessage: (convId, msg) => set(s => {
    const prev = s.messages[convId] || []
    if (prev.some(m => m.id === msg.id)) return {}
    return { messages: { ...s.messages, [convId]: [...prev, msg] } }
  }),
  updateMessage: (convId, msgId, fields) => set(s => {
    const prev = s.messages[convId] || []
    return {
      messages: {
        ...s.messages,
        [convId]: prev.map(m => m.id === msgId ? { ...m, ...fields } : m)
      }
    }
  }),
  deleteMessage: (convId, msgId) => set(s => {
    const prev = s.messages[convId] || []
    return {
      messages: {
        ...s.messages,
        [convId]: prev.map(m => m.id === msgId ? { ...m, deleted: true, content: '🗑 Сообщение удалено' } : m)
      }
    }
  }),

  incrementUnread: (convId) => set(s => ({
    unread: { ...s.unread, [convId]: (s.unread[convId] || 0) + 1 },
    conversations: s.conversations.map(c =>
      c.id === convId ? { ...c, unread: (c.unread || 0) + 1 } : c
    )
  })),

  setTyping: (convId, users) => set(s => ({
    typing: { ...s.typing, [convId]: users }
  })),

  updateConvLastMessage: (convId, msg) => set(s => ({
    conversations: s.conversations.map(c =>
      c.id === convId
        ? { ...c, lastMessage: msg.content, lastMessageAt: msg.createdAt }
        : c
    )
  })),

  // Servers
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  serverMembers: {},   // { [serverId]: Member[] }
  channelMessages: {}, // { [channelId]: Message[] }
  serverChannels: {},  // { [serverId]: Channel[] }

  setServers: (list) => set({ servers: list }),
  setActiveServer: (id) => set({ activeServerId: id, activeChannelId: null, activeConvId: null }),
  setActiveChannel: (id) => set({ activeChannelId: id }),
  setServerMembers: (sid, members) => set(s => ({
    serverMembers: { ...s.serverMembers, [sid]: members }
  })),
  setServerChannels: (sid, channels) => set(s => ({
    serverChannels: { ...s.serverChannels, [sid]: channels }
  })),
  setChannelMessages: (chId, msgs) => set(s => ({
    channelMessages: { ...s.channelMessages, [chId]: msgs }
  })),
  appendChannelMessage: (chId, msg) => set(s => {
    const prev = s.channelMessages[chId] || []
    return { channelMessages: { ...s.channelMessages, [chId]: [...prev, msg] } }
  }),

  // Call
  incomingCall: null,
  activeCall: null,
  setIncomingCall: (call) => set({ incomingCall: call }),
  setActiveCall: (callOrFn) => set(s => ({
    activeCall: typeof callOrFn === 'function' ? callOrFn(s.activeCall) : callOrFn
  })),

  // Toasts
  toasts: [],
  addToast: (toast) => {
    const id = Date.now()
    set(s => ({ toasts: [...s.toasts, { id, ...toast }] }))
    setTimeout(() => get().removeToast(id), toast.duration || 4000)
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // Theme
  theme: 'violet',
  setTheme: (t) => {
    set({ theme: t })
    applyTheme(t)
  },

  // View
  view: 'chats', // 'chats' | 'servers' | 'profile' | 'shop' | 'admin'
  setView: (v) => set({ view: v }),
}))

const THEMES = {
  violet: '#7c3aed',
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
  orange: '#ea580c',
  pink: '#db2777',
  cyan: '#0891b2',
  gold: '#d97706',
}

export function applyTheme(name) {
  const color = THEMES[name] || THEMES.violet
  document.documentElement.style.setProperty('--accent', color)
  const d = parseInt(color.slice(1), 16)
  const r = (d >> 16) & 255, g = (d >> 8) & 255, b = d & 255
  const darken = (v, f) => Math.max(0, Math.floor(v * f))
  const toHex = (v) => v.toString(16).padStart(2, '0')
  document.documentElement.style.setProperty('--acc2', `#${toHex(darken(r,0.85))}${toHex(darken(g,0.85))}${toHex(darken(b,0.85))}`)
  document.documentElement.style.setProperty('--acc3', `#${toHex(darken(r,0.72))}${toHex(darken(g,0.72))}${toHex(darken(b,0.72))}`)
}

export default useStore
