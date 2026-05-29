import React from 'react'
import useStore from '../store/useStore'
import styles from './ToastContainer.module.css'

const ICONS = {
  message: '💬',
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
}

export default function ToastContainer() {
  const { toasts, removeToast } = useStore()

  return (
    <div className={styles.container}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type || 'info']}`}
          onClick={() => removeToast(t.id)}>
          <span className={styles.icon}>{ICONS[t.type] || ICONS.info}</span>
          <div className={styles.content}>
            <div className={styles.title}>{t.title}</div>
            {t.body && <div className={styles.body}>{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
