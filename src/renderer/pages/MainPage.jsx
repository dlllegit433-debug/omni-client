import React, { useEffect } from 'react'
import useStore from '../store/useStore'
import { get } from '../lib/api'
import TitleBar from '../components/TitleBar'
import Sidebar from '../components/Sidebar'
import ChatView from '../components/chat/ChatView'
import ServerView from '../components/server/ServerView'
import ProfilePage from './ProfilePage'
import ShopPage from './ShopPage'
import AdminPage from './AdminPage'
import styles from './MainPage.module.css'

export default function MainPage({ getWs }) {
  const { view, activeConvId, activeServerId, setConversations, setServers, me } = useStore()

  useEffect(() => {
    loadConversations()
    loadServers()
  }, [])

  async function loadConversations() {
    const res = await get('/api/conversations')
    if (res.ok) {
      useStore.getState().setConversations(res.data.conversations || res.data || [])
    }
  }

  async function loadServers() {
    const res = await get('/api/servers')
    if (res.ok) {
      useStore.getState().setServers(res.data.servers || res.data || [])
    }
  }

  function renderMain() {
    if (view === 'profile') return <ProfilePage />
    if (view === 'shop') return <ShopPage />
    if (view === 'admin') return <AdminPage />
    if (view === 'servers' && activeServerId) return <ServerView getWs={getWs} />
    if (view === 'chats' && activeConvId) return <ChatView getWs={getWs} />
    return <EmptyState view={view} />
  }

  return (
    <div className={styles.root}>
      <TitleBar />
      <div className={styles.body}>
        <Sidebar getWs={getWs} onRefreshConvs={loadConversations} onRefreshServers={loadServers} />
        <main className={styles.main}>
          {renderMain()}
        </main>
      </div>
    </div>
  )
}

function EmptyState({ view }) {
  const hints = {
    chats: { icon: '💬', title: 'Выберите чат', sub: 'Нажмите на разговор в боковом меню' },
    servers: { icon: '🖥', title: 'Выберите сервер', sub: 'Выберите сервер и канал в боковом меню' },
  }
  const h = hints[view] || hints.chats
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{h.icon}</div>
      <div className={styles.emptyTitle}>{h.title}</div>
      <div className={styles.emptySub}>{h.sub}</div>
    </div>
  )
}
