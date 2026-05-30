import React, { useState, useEffect } from 'react'
import useStore from '../store/useStore'
import styles from './SettingsPage.module.css'

const NOTIFICATION_SOUNDS = [
  { id: 'default', label: 'Стандартный' },
  { id: 'soft', label: 'Мягкий' },
  { id: 'chime', label: 'Звонок' },
  { id: 'pop', label: 'Поп' },
  { id: 'none', label: 'Без звука' },
]

function playSound(soundId) {
  if (soundId === 'none') return
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const gainNode = ctx.createGain()
  gainNode.connect(ctx.destination)
  gainNode.gain.setValueAtTime(0.3, ctx.currentTime)

  const osc = ctx.createOscillator()
  osc.connect(gainNode)

  switch (soundId) {
    case 'soft':
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(480, ctx.currentTime + 0.2)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.4)
      break
    case 'chime':
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.6)
      break
    case 'pop':
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1000, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.15)
      break
    default:
      osc.type = 'sine'
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.5)
      break
  }
}

export { playSound }

export default function SettingsPage() {
  const { settings, updateSettings, addToast } = useStore()

  const [notifSound, setNotifSound] = useState(settings?.notifSound || 'default')
  const [autoStart, setAutoStart] = useState(settings?.autoStart || false)
  const [minimizeToTray, setMinimizeToTray] = useState(settings?.minimizeToTray !== false)
  const [notifBanner, setNotifBanner] = useState(settings?.notifBanner !== false)
  const [showOnline, setShowOnline] = useState(settings?.showOnline !== false)

  useEffect(() => {
    async function loadAutoStart() {
      if (window.electron?.getAutoStart) {
        const enabled = await window.electron.getAutoStart()
        setAutoStart(enabled)
      }
    }
    loadAutoStart()
  }, [])

  async function saveSettings() {
    const newSettings = { notifSound, autoStart, minimizeToTray, notifBanner, showOnline }
    updateSettings(newSettings)
    if (window.electron?.setAutoStart) {
      await window.electron.setAutoStart(autoStart)
    }
    addToast({ title: 'Настройки сохранены', type: 'success' })
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <h2 className={styles.title}>⚙️ Настройки</h2>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>🔔 Уведомления</h3>
          <div className={styles.field}>
            <label className={styles.label}>Звук уведомлений</label>
            <div className={styles.soundGrid}>
              {NOTIFICATION_SOUNDS.map(s => (
                <button
                  key={s.id}
                  className={`${styles.soundBtn} ${notifSound === s.id ? styles.soundBtnActive : ''}`}
                  onClick={() => { setNotifSound(s.id); playSound(s.id) }}
                >
                  {s.id === 'none' ? '🔇' : '🔊'} {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Всплывающий баннер сообщений</label>
            <label className={styles.toggleRow}>
              <div className={`${styles.toggle} ${notifBanner ? styles.toggleOn : ''}`}
                onClick={() => setNotifBanner(!notifBanner)}>
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.toggleLabel}>{notifBanner ? 'Включён' : 'Выключен'}</span>
            </label>
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>🖥️ Приложение</h3>
          <div className={styles.field}>
            <label className={styles.label}>Автозапуск при старте системы</label>
            <label className={styles.toggleRow}>
              <div className={`${styles.toggle} ${autoStart ? styles.toggleOn : ''}`}
                onClick={() => setAutoStart(!autoStart)}>
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.toggleLabel}>{autoStart ? 'Включён' : 'Выключен'}</span>
            </label>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Сворачивать в трей при закрытии</label>
            <label className={styles.toggleRow}>
              <div className={`${styles.toggle} ${minimizeToTray ? styles.toggleOn : ''}`}
                onClick={() => setMinimizeToTray(!minimizeToTray)}>
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.toggleLabel}>{minimizeToTray ? 'Включён' : 'Выключен'}</span>
            </label>
          </div>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>👤 Приватность</h3>
          <div className={styles.field}>
            <label className={styles.label}>Показывать статус "в сети"</label>
            <label className={styles.toggleRow}>
              <div className={`${styles.toggle} ${showOnline ? styles.toggleOn : ''}`}
                onClick={() => setShowOnline(!showOnline)}>
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.toggleLabel}>{showOnline ? 'Включён' : 'Выключен'}</span>
            </label>
          </div>
        </div>

        <button className={styles.saveBtn} onClick={saveSettings}>
          Сохранить настройки
        </button>
      </div>
    </div>
  )
}
