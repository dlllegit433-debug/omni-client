import React, { useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import Avatar from './Avatar'
import styles from './MessageNotificationBanner.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

function fullUrl(url) {
  if (!url) return ''
  return url.startsWith('http') ? url : BASE_URL + url
}

let soundPlaying = false
let soundTimer = null

export function playNotificationSound(soundId) {
  if (soundId === 'none') return
  if (soundPlaying) return
  soundPlaying = true
  clearTimeout(soundTimer)

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const gainNode = ctx.createGain()
    gainNode.connect(ctx.destination)

    const playTone = (freq, startTime, duration, type = 'sine') => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.connect(g)
      g.connect(ctx.destination)
      osc.type = type
      osc.frequency.setValueAtTime(freq, startTime)
      g.gain.setValueAtTime(0.25, startTime)
      g.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
      osc.start(startTime)
      osc.stop(startTime + duration)
    }

    switch (soundId) {
      case 'soft':
        playTone(520, ctx.currentTime, 0.3)
        playTone(440, ctx.currentTime + 0.15, 0.3)
        break
      case 'chime':
        playTone(880, ctx.currentTime, 0.3, 'triangle')
        playTone(1100, ctx.currentTime + 0.15, 0.3, 'triangle')
        playTone(880, ctx.currentTime + 0.3, 0.4, 'triangle')
        break
      case 'pop':
        playTone(1000, ctx.currentTime, 0.08, 'sine')
        break
      default:
        playTone(660, ctx.currentTime, 0.15)
        playTone(880, ctx.currentTime + 0.15, 0.25)
        break
    }
  } catch {}

  soundTimer = setTimeout(() => {
    soundPlaying = false
  }, 21000)
}

export default function MessageNotificationBanner() {
  const { notifQueue, dismissNotif, settings } = useStore()
  const notif = notifQueue?.[0] || null

  useEffect(() => {
    if (!notif) return
    const soundId = settings?.notifSound || 'default'
    if (settings?.notifBanner !== false) {
      playNotificationSound(soundId)
    }
    const timer = setTimeout(() => {
      useStore.getState().dismissNotif(notif.id)
    }, 5000)
    return () => clearTimeout(timer)
  }, [notif?.id])

  if (!notif || settings?.notifBanner === false) return null

  const avatarUrl = notif.avatar ? fullUrl(notif.avatar) : null

  return (
    <div className={styles.banner} onClick={() => useStore.getState().dismissNotif(notif.id)}>
      <div className={styles.avatarWrap}>
        <Avatar name={notif.title} size={42} src={avatarUrl} />
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{notif.title}</div>
        {notif.body && <div className={styles.body}>{notif.body}</div>}
      </div>
      <button className={styles.closeBtn} onClick={e => { e.stopPropagation(); useStore.getState().dismissNotif(notif.id) }}>✕</button>
    </div>
  )
}
