import React, { useState, useEffect } from 'react'
import { post } from '../lib/api'
import useStore from '../store/useStore'
import styles from './StickerPackPopup.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

function fullUrl(u) {
  if (!u) return ''
  return u.startsWith('http') ? u : BASE_URL + u
}

export default function StickerPackPopup({ slug, onClose, onAddPack }) {
  const [pack, setPack] = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const { addToast } = useStore()

  useEffect(() => {
    if (!slug) return
    fetch(`${BASE_URL}/api/sticker-packs/${slug}`)
      .then(r => r.json())
      .then(d => { if (d.pack) setPack(d.pack) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug])

  async function addPack() {
    if (!pack) return
    setAdding(true)
    const res = await post(`/api/sticker-packs/${pack.id}/add`)
    setAdding(false)
    if (res.ok) {
      setAdded(true)
      onAddPack && onAddPack(pack)
      addToast({ title: '✅ Пак добавлен', body: `"${pack.name}" добавлен в ваши стикеры`, type: 'success' })
    } else {
      addToast({ title: 'Ошибка', body: res.data?.error || 'Не удалось добавить', type: 'error' })
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.popup} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>

        {loading && (
          <div className={styles.loading}>
            <div className={styles.loadDot} />
            <span>Загрузка...</span>
          </div>
        )}

        {!loading && !pack && (
          <div className={styles.notFound}>
            <div className={styles.notFoundIcon}>📦</div>
            <div>Пак не найден</div>
          </div>
        )}

        {!loading && pack && (
          <>
            <div className={styles.header}>
              <div className={styles.cover}>
                {pack.coverUrl
                  ? <img src={fullUrl(pack.coverUrl)} alt={pack.name} />
                  : <span>📦</span>
                }
              </div>
              <div className={styles.info}>
                <div className={styles.name}>{pack.name}</div>
                {pack.description && <div className={styles.desc}>{pack.description}</div>}
                <div className={styles.meta}>{pack.stickers?.length || 0} стикеров • @{pack.authorUsername}</div>
                <div className={styles.link}>Om.org/{pack.slug}</div>
              </div>
            </div>

            {pack.stickers && pack.stickers.length > 0 && (
              <div className={styles.grid}>
                {pack.stickers.slice(0, 20).map(s => (
                  <div key={s.id} className={styles.stickerItem}>
                    <img src={fullUrl(s.fileUrl)} alt={s.name} loading="lazy" />
                  </div>
                ))}
              </div>
            )}

            <button
              className={`${styles.addBtn} ${added ? styles.addBtnAdded : ''}`}
              onClick={addPack}
              disabled={adding || added}
            >
              {added ? '✅ Добавлено' : adding ? 'Добавление...' : '➕ Добавить пак'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
