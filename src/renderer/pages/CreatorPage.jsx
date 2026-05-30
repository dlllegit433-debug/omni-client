import React, { useState, useEffect, useRef } from 'react'
import { get, post, del } from '../lib/api'
import useStore from '../store/useStore'
import styles from './CreatorPage.module.css'

const BASE_URL = 'https://omnii.duckdns.org:3000'

function fullUrl(u) {
  if (!u) return ''
  return u.startsWith('http') ? u : BASE_URL + u
}

export default function CreatorPage() {
  const { me } = useStore()
  const [tab, setTab] = useState('stickers')

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>🎨</span>
          <div>
            <div className={styles.headerTitle}>Creator Studio</div>
            <div className={styles.headerSub}>Создавай стикеры, эмодзи и делись ими</div>
          </div>
        </div>
        <CatalogLinkButton />
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'stickers' ? styles.tabActive : ''}`} onClick={() => setTab('stickers')}>
          📦 Стикер-паки
        </button>
        <button className={`${styles.tab} ${tab === 'emojis' ? styles.tabActive : ''}`} onClick={() => setTab('emojis')}>
          😊 Кастомные эмодзи
        </button>
      </div>

      <div className={styles.content}>
        {tab === 'stickers' && <StickerPacksTab me={me} />}
        {tab === 'emojis' && <CustomEmojisTab me={me} />}
      </div>
    </div>
  )
}

function CatalogLinkButton() {
  const [loading, setLoading] = useState(false)
  const { addToast } = useStore()

  async function openCatalog() {
    setLoading(true)
    try {
      const res = await post('/api/catalog/session-link')
      if (res.ok) {
        const catalogUrl = `${BASE_URL}/catalog?catalog_token=${res.data.token}`
        window.open(catalogUrl, '_blank')
      } else {
        addToast({ title: 'Ошибка', body: res.data?.error || 'Не удалось открыть каталог', type: 'error' })
      }
    } catch {
      addToast({ title: 'Ошибка', body: 'Нет подключения', type: 'error' })
    }
    setLoading(false)
  }

  return (
    <button className={styles.catalogBtn} onClick={openCatalog} disabled={loading}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
      {loading ? 'Открытие...' : 'Открыть каталог'}
    </button>
  )
}

function StickerPacksTab({ me }) {
  const [packs, setPacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPack, setSelectedPack] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const { addToast } = useStore()

  useEffect(() => { loadPacks() }, [])

  async function loadPacks() {
    setLoading(true)
    const res = await get('/api/my-authored-packs')
    if (res.ok) setPacks(res.data.packs || [])
    setLoading(false)
  }

  function deletePack(packId) {
    setDeleteModal(packId)
  }

  async function confirmDeletePack() {
    const packId = deleteModal
    setDeleteModal(null)
    const res = await del(`/api/sticker-packs/${packId}`)
    if (res.ok) { loadPacks(); setSelectedPack(null) }
    else addToast({ title: 'Ошибка', body: res.data?.error || 'Не удалось удалить', type: 'error' })
  }

  if (selectedPack) {
    return <PackEditor pack={selectedPack} onBack={() => { setSelectedPack(null); loadPacks() }} />
  }

  return (
    <div>
      <div className={styles.sectionBar}>
        <span className={styles.sectionTitle}>Мои стикер-паки</span>
        <button className={styles.createBtn} onClick={() => setShowCreate(true)}>+ Новый пак</button>
      </div>

      {showCreate && (
        <CreatePackForm onDone={(pack) => { setShowCreate(false); loadPacks(); setSelectedPack(pack) }} onCancel={() => setShowCreate(false)} />
      )}

      {loading && <div className={styles.loadState}>Загрузка...</div>}
      {!loading && packs.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📦</div>
          <div className={styles.emptyTitle}>Нет стикер-паков</div>
          <div className={styles.emptySub}>Создай свой первый пак и загрузи стикеры!</div>
        </div>
      )}

      <div className={styles.packGrid}>
        {packs.map(pack => (
          <div key={pack.id} className={styles.packCard} onClick={() => setSelectedPack(pack)}>
            <div className={styles.packCover}>
              {pack.coverUrl
                ? <img src={fullUrl(pack.coverUrl)} alt={pack.name} />
                : <span>📦</span>
              }
            </div>
            <div className={styles.packInfo}>
              <div className={styles.packName}>{pack.name}</div>
              <div className={styles.packMeta}>{pack.stickers?.length ?? pack.stickerCount ?? 0} стикеров</div>
              <div className={styles.packLink}>Om.org/{pack.slug}</div>
            </div>
            <button className={styles.packDelete} onClick={e => { e.stopPropagation(); deletePack(pack.id) }} title="Удалить">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setDeleteModal(null)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, minWidth: 320, maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🗑 Удалить пак?</div>
            <div style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 20 }}>Все стикеры будут удалены. Это действие нельзя отменить.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className={styles.cancelBtn} onClick={() => setDeleteModal(null)}>Отмена</button>
              <button className={styles.submitBtn} style={{ background: '#ef4444' }} onClick={confirmDeletePack}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreatePackForm({ onDone, onCancel }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function onNameChange(v) {
    setName(v)
    if (!slug || slug === name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')) {
      setSlug(v.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    }
  }

  async function submit() {
    if (!name.trim() || !slug.trim()) { setError('Заполните название и slug'); return }
    setLoading(true); setError('')
    const res = await post('/api/sticker-packs', { json: { name, slug, description: desc } })
    setLoading(false)
    if (res.ok) onDone(res.data.pack)
    else setError(res.data?.error || 'Ошибка')
  }

  return (
    <div className={styles.createForm}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Название пака</label>
        <input className={styles.formInput} value={name} onChange={e => onNameChange(e.target.value)} placeholder="Мой пак стикеров" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Slug (Om.org/<b>{slug || 'slug'}</b>)</label>
        <input className={styles.formInput} value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="moy_pak" />
      </div>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>Описание (необязательно)</label>
        <input className={styles.formInput} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание..." />
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onCancel}>Отмена</button>
        <button className={styles.submitBtn} onClick={submit} disabled={loading}>{loading ? 'Создание...' : 'Создать'}</button>
      </div>
    </div>
  )
}

function PackEditor({ pack, onBack }) {
  const [stickers, setStickers] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [stickerName, setStickerName] = useState('')
  const fileRef = useRef(null)
  const { addToast } = useStore()

  useEffect(() => { loadStickers() }, [pack.id])

  async function loadStickers() {
    setLoading(true)
    const res = await get(`/api/sticker-packs/${pack.id}/stickers`)
    if (res.ok) setStickers(res.data.stickers || [])
    setLoading(false)
  }

  async function uploadSticker(file) {
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('name', stickerName.trim() || file.name.replace(/\.[^.]+$/, ''))
    const res = await post(`/api/sticker-packs/${pack.id}/stickers`, { form })
    setUploading(false)
    if (res.ok) { setStickerName(''); loadStickers() }
    else addToast({ title: 'Ошибка', body: res.data?.error || 'Ошибка загрузки', type: 'error' })
  }

  async function deleteSticker(stickerId) {
    const res = await del(`/api/sticker-packs/${pack.id}/stickers/${stickerId}`)
    if (res.ok) loadStickers()
  }

  function copyLink() {
    navigator.clipboard.writeText(`Om.org/${pack.slug}`)
    addToast({ title: 'Скопировано', body: `Om.org/${pack.slug}`, type: 'success' })
  }

  return (
    <div>
      <button className={styles.backBtn} onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Назад
      </button>

      <div className={styles.packEditorHeader}>
        <div className={styles.packEditorCover}>
          {pack.coverUrl ? <img src={fullUrl(pack.coverUrl)} alt={pack.name} /> : <span>📦</span>}
        </div>
        <div>
          <div className={styles.packEditorName}>{pack.name}</div>
          {pack.description && <div className={styles.packEditorDesc}>{pack.description}</div>}
          <button className={styles.linkBtn} onClick={copyLink}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            Om.org/{pack.slug}
          </button>
        </div>
      </div>

      <div className={styles.uploadSection}>
        <div className={styles.uploadRow}>
          <input
            className={styles.formInput}
            value={stickerName}
            onChange={e => setStickerName(e.target.value)}
            placeholder="Название стикера (необязательно)"
            style={{ flex: 1 }}
          />
          <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {uploading ? 'Загрузка...' : 'Загрузить стикер'}
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} accept="image/*" onChange={e => { uploadSticker(e.target.files[0]); e.target.value = '' }} />
        </div>
        <div className={styles.uploadHint}>PNG, JPG, GIF — до 10 МБ. Рекомендуется 512×512.</div>
      </div>

      {loading && <div className={styles.loadState}>Загрузка стикеров...</div>}
      {!loading && stickers.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🖼</div>
          <div className={styles.emptyTitle}>Нет стикеров</div>
          <div className={styles.emptySub}>Загрузи первый стикер в пак</div>
        </div>
      )}

      <div className={styles.stickerGrid}>
        {stickers.map(s => (
          <div key={s.id} className={styles.stickerItem}>
            <img src={fullUrl(s.fileUrl || s.imageUrl)} alt={s.name} />
            <div className={styles.stickerItemName}>{s.name}</div>
            <button className={styles.stickerDelete} onClick={() => deleteSticker(s.id)} title="Удалить">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CustomEmojisTab({ me }) {
  const [emojis, setEmojis] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const { addToast } = useStore()

  useEffect(() => { loadEmojis() }, [])

  async function loadEmojis() {
    setLoading(true)
    const res = await get('/api/custom-emojis')
    if (res.ok) setEmojis(res.data.emojis || [])
    setLoading(false)
  }

  async function uploadEmoji(file) {
    if (!file || !name.trim()) { setError('Введите название'); return }
    setError(''); setUploading(true)
    const form = new FormData()
    form.append('image', file)
    form.append('name', name.trim())
    const res = await post('/api/custom-emojis', { form })
    setUploading(false)
    if (res.ok) { setName(''); loadEmojis() }
    else setError(res.data?.error || 'Ошибка загрузки')
  }

  async function deleteEmoji(id) {
    const res = await del(`/api/custom-emojis/${id}`)
    if (res.ok) loadEmojis()
  }

  return (
    <div>
      <div className={styles.sectionBar}>
        <span className={styles.sectionTitle}>Кастомные эмодзи</span>
      </div>

      <div className={styles.createForm}>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Название (будет :название:)</label>
          <div className={styles.uploadRow}>
            <input className={styles.formInput} value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="my_emoji" style={{ flex: 1 }} />
            <button className={styles.uploadBtn} onClick={() => fileRef.current?.click()} disabled={uploading || !name.trim()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {uploading ? 'Загрузка...' : 'Загрузить'}
            </button>
            <input ref={fileRef} type="file" style={{ display: 'none' }} accept="image/*" onChange={e => { uploadEmoji(e.target.files[0]); e.target.value = '' }} />
          </div>
          {error && <div className={styles.formError}>{error}</div>}
          <div className={styles.uploadHint}>PNG, GIF — до 2 МБ. Квадратное изображение.</div>
        </div>
      </div>

      {loading && <div className={styles.loadState}>Загрузка...</div>}
      {!loading && emojis.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>😊</div>
          <div className={styles.emptyTitle}>Нет кастомных эмодзи</div>
          <div className={styles.emptySub}>Создай свой первый эмодзи!</div>
        </div>
      )}

      <div className={styles.emojiGrid}>
        {emojis.map(e => (
          <div key={e.id} className={styles.emojiItem}>
            <img src={fullUrl(e.imageUrl)} alt={e.name} />
            <div className={styles.emojiItemName}>:{e.name}:</div>
            <div className={styles.emojiItemAuthor}>@{e.authorUsername}</div>
            {(e.authorUsername === me?.username || me?.isAdmin) && (
              <button className={styles.stickerDelete} onClick={() => deleteEmoji(e.id)} title="Удалить">✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
