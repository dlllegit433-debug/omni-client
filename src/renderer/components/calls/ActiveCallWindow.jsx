import React, { useState, useEffect } from 'react'
import useStore from '../../store/useStore'
import { callManager } from '../../lib/webrtc'
import Avatar from '../Avatar'
import styles from './ActiveCallWindow.module.css'

export default function ActiveCallWindow({ getWs }) {
  const { activeCall, setActiveCall, addToast } = useStore()
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (activeCall?.state !== 'connected') return
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [activeCall?.state])

  function toggleMute() {
    const m = callManager.toggleMute()
    setMuted(m)
  }

  function endCall() {
    const ws = getWs()
    if (ws && activeCall) {
      ws.send({ type: 'call_end', targetUserId: activeCall.peerId, callId: activeCall.callId })
    }
    callManager.hangup()
    setActiveCall(null)
  }

  if (!activeCall) return null

  const fmtElapsed = () => {
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0')
    const s = (elapsed % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className={styles.window}>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <Avatar name={activeCall.peerName} size={40} />
          {activeCall.state === 'connected' && <div className={styles.activeDot} />}
        </div>
        <div className={styles.info}>
          <span className={styles.name}>{activeCall.peerName}</span>
          <span className={styles.status}>
            {activeCall.state === 'calling'
              ? <><span className={styles.pulse} />Дозваниваемся...</>
              : activeCall.state === 'connected'
              ? <>🟢 {fmtElapsed()}</>
              : activeCall.state}
          </span>
        </div>
        <div className={styles.controls}>
          <button
            className={`${styles.ctrl} ${muted ? styles.ctrlMuted : ''}`}
            onClick={toggleMute}
            title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {muted
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
            }
          </button>
          <button className={styles.endBtn} onClick={endCall} title="Завершить звонок">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
