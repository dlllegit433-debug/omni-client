import React from 'react'
import { AudioCall } from '../../lib/audio'
import useStore from '../../store/useStore'
import Avatar from '../Avatar'
import styles from './IncomingCallModal.module.css'

export default function IncomingCallModal({ call, getWs }) {
  const { setIncomingCall, setActiveCall, addToast } = useStore()
  const callerName = call.callerName || call.callerId

  function accept() {
    const ws = getWs()
    if (!ws) return
    ws.send({ type: 'call_answer', targetUserId: call.callerId, callId: call.callId, answer: {} })
    const audio = new AudioCall({ ws, peerId: call.callerId, callId: call.callId })
    audio.start().catch(err => addToast({ title: 'Звонок', body: err.message, type: 'error' }))
    setActiveCall({ peerId: call.callerId, peerName: callerName, callId: call.callId, state: 'connected', startTime: Date.now(), audio })
    setIncomingCall(null)
  }

  function reject() {
    const ws = getWs()
    ws?.send({ type: 'call_reject', callerId: call.callerId, callId: call.callId })
    setIncomingCall(null)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.ring}>📞</div>
        <Avatar name={callerName} size={64} />
        <div className={styles.name}>{callerName}</div>
        <div className={styles.sub}>Входящий звонок...</div>
        <div className={styles.actions}>
          <button className={styles.rejectBtn} onClick={reject}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23 16.92a1 1 0 00-1-1h-3a1 1 0 00-1 .89 11 11 0 01-1.5 3.61 1 1 0 00.27 1.26l1.86 1.38a15 15 0 01-6.71 6.71l-1.38-1.86a1 1 0 00-1.26-.27 11 11 0 01-3.61 1.5A1 1 0 003 29.92v3a1 1 0 001 1A21 21 0 0025 12.92a1 1 0 00-1-1h-1z" transform="scale(0.85) rotate(135,12,12)"/>
            </svg>
            Отклонить
          </button>
          <button className={styles.acceptBtn} onClick={accept}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.59 10.59 19.79 19.79 0 01.5 2a2 2 0 012-2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.6 7.84a16 16 0 006.59 6.59l1.18-1.18a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
            </svg>
            Принять
          </button>
        </div>
      </div>
    </div>
  )
}
