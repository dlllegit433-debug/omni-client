import React, { useEffect, useRef } from 'react'
import { callManager } from '../../lib/webrtc'
import useStore from '../../store/useStore'
import Avatar from '../Avatar'
import styles from './IncomingCallModal.module.css'

export default function IncomingCallModal({ call, getWs }) {
  const { setIncomingCall, setActiveCall, addToast } = useStore()
  const callerName = call.callerName || call.callerId
  const ringRef = useRef(null)

  useEffect(() => {
    try {
      const ctx = new AudioContext()
      let t = ctx.currentTime
      const ring = () => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.frequency.setValueAtTime(880, t)
        g.gain.setValueAtTime(0.3, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
        o.start(t); o.stop(t + 0.4)
        t += 0.8
      }
      for (let i = 0; i < 20; i++) ring()
      ringRef.current = ctx
    } catch {}
    return () => { try { ringRef.current?.close() } catch {} }
  }, [])

  async function accept() {
    try { ringRef.current?.close() } catch {}
    const ws = getWs()
    if (!ws) return
    try {
      await callManager.answerCall(ws, call.callerId, call.callId, call.offer)
      setActiveCall({ peerId: call.callerId, peerName: callerName, callId: call.callId, state: 'connected', startTime: Date.now() })
      setIncomingCall(null)
    } catch (err) {
      addToast({ title: 'Звонок', body: err.message || 'Ошибка подключения', type: 'error' })
      setIncomingCall(null)
    }
  }

  function reject() {
    try { ringRef.current?.close() } catch {}
    const ws = getWs()
    ws?.send({ type: 'call_reject', callerId: call.callerId, callId: call.callId })
    setIncomingCall(null)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.ring}>
          <span>📞</span>
        </div>
        <Avatar name={callerName} size={72} />
        <div className={styles.name}>{callerName}</div>
        <div className={styles.sub}>Входящий голосовой звонок</div>
        <div className={styles.actions}>
          <button className={styles.rejectBtn} onClick={reject}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
              <line x1="23" y1="1" x2="1" y2="23"/>
            </svg>
            <span>Отклонить</span>
          </button>
          <button className={styles.acceptBtn} onClick={accept}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.59 10.59 19.79 19.79 0 01.5 2a2 2 0 012-2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.6 7.84a16 16 0 006.59 6.59l1.18-1.18a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
            </svg>
            <span>Принять</span>
          </button>
        </div>
      </div>
    </div>
  )
}
