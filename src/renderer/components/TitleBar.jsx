import React, { useState, useEffect } from 'react'
import styles from './TitleBar.module.css'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.electron?.window.isMaximized().then(setMaximized)
  }, [])

  function minimize() { window.electron?.window.minimize() }
  function maximize() {
    window.electron?.window.maximize().then(() => {
      window.electron?.window.isMaximized().then(setMaximized)
    })
  }
  function close() { window.electron?.window.close() }

  return (
    <div className={styles.bar}>
      <div className={styles.drag}>
        <span className={styles.appName}>Omni</span>
      </div>
      <div className={styles.controls}>
        <button className={styles.btn} onClick={minimize} title="Свернуть">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className={styles.btn} onClick={maximize} title={maximized ? 'Восстановить' : 'Развернуть'}>
          {maximized
            ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 3h7v7H0V3zM3 0h7v7" stroke="currentColor" fill="none" strokeWidth="1"/></svg>
            : <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none"/></svg>
          }
        </button>
        <button className={`${styles.btn} ${styles.closeBtn}`} onClick={close} title="Закрыть">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
