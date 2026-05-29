import React, { useState, useEffect } from 'react'
import { get, post } from '../lib/api'
import useStore from '../store/useStore'
import styles from './ShopPage.module.css'

const COIN_PACKS = [
  { amount: 100,  price: 49,  label: 'Стартовый',  icon: '💰' },
  { amount: 500,  price: 199, label: 'Популярный', icon: '💎', popular: true },
  { amount: 1000, price: 349, label: 'Крупный',    icon: '🏆' },
  { amount: 5000, price: 999, label: 'Максимум',   icon: '👑' },
]

const GIFTS = [
  { id: 'heart',    name: 'Сердце',    emoji: '❤️',  price: 10,  rarity: 'common' },
  { id: 'rose',     name: 'Роза',      emoji: '🌹',  price: 15,  rarity: 'common' },
  { id: 'star',     name: 'Звезда',    emoji: '⭐',  price: 25,  rarity: 'common' },
  { id: 'fire',     name: 'Огонь',     emoji: '🔥',  price: 30,  rarity: 'rare' },
  { id: 'rainbow',  name: 'Радуга',    emoji: '🌈',  price: 50,  rarity: 'rare' },
  { id: 'rocket',   name: 'Ракета',    emoji: '🚀',  price: 75,  rarity: 'rare' },
  { id: 'gem',      name: 'Гем',       emoji: '💎',  price: 100, rarity: 'epic' },
  { id: 'crown',    name: 'Корона',    emoji: '👑',  price: 150, rarity: 'epic' },
  { id: 'trophy',   name: 'Трофей',    emoji: '🏆',  price: 200, rarity: 'epic' },
  { id: 'unicorn',  name: 'Единорог',  emoji: '🦄',  price: 500, rarity: 'legendary' },
]

const RARITY_COLORS = {
  common:    { color: '#9898b8', label: 'Обычный' },
  rare:      { color: '#2563eb', label: 'Редкий' },
  epic:      { color: '#7c3aed', label: 'Эпик' },
  legendary: { color: '#d97706', label: 'Легенда' },
}

export default function ShopPage() {
  const { me, updateMe, addToast } = useStore()
  const [tab, setTab] = useState('gifts')
  const [history, setHistory] = useState([])
  const [giftTarget, setGiftTarget] = useState('')
  const [giftModal, setGiftModal] = useState(null)

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab])

  async function loadHistory() {
    const res = await get('/api/coins/history')
    if (res.ok) setHistory(res.data.history || res.data || [])
  }

  async function buyCoins(pack) {
    const res = await post('/api/coins/buy', { json: { amount: pack.amount } })
    if (res.ok && res.data.paymentUrl) {
      window.electron?.openExternal(res.data.paymentUrl)
    } else {
      addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  async function sendGift(gift, username) {
    if (!username.trim()) return addToast({ title: 'Укажите имя пользователя', type: 'warning' })
    const res = await post('/api/gifts/send', { json: { giftId: gift.id, targetUsername: username } })
    if (res.ok) {
      updateMe({ coins: (me?.coins || 0) - gift.price })
      addToast({ title: `${gift.emoji} Подарок отправлен!`, body: `${gift.name} → ${username}`, type: 'success' })
      setGiftModal(null)
      setGiftTarget('')
    } else {
      addToast({ title: res.data.error || 'Ошибка', type: 'error' })
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h2 className={styles.title}>Магазин</h2>
          <div className={styles.balance}>
            💰 <strong>{me?.coins || 0}</strong> монет
          </div>
        </div>

        <div className={styles.tabs}>
          {['gifts','coins','history'].map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              {{ gifts: '🎁 Подарки', coins: '💰 Монеты', history: '📋 История' }[t]}
            </button>
          ))}
        </div>

        {tab === 'gifts' && (
          <div className={styles.giftsGrid}>
            {GIFTS.map(g => {
              const rarity = RARITY_COLORS[g.rarity]
              return (
                <div key={g.id} className={styles.giftCard}>
                  <div className={styles.giftEmoji}>{g.emoji}</div>
                  <div className={styles.giftName}>{g.name}</div>
                  <div className={styles.giftRarity} style={{ color: rarity.color }}>{rarity.label}</div>
                  <div className={styles.giftPrice}>💰 {g.price}</div>
                  <button className={styles.giftBtn} onClick={() => setGiftModal(g)}>Подарить</button>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'coins' && (
          <div className={styles.coinsGrid}>
            {COIN_PACKS.map(p => (
              <div key={p.amount} className={`${styles.coinCard} ${p.popular ? styles.coinCardPopular : ''}`}>
                {p.popular && <div className={styles.popularBadge}>Популярный</div>}
                <div className={styles.coinIcon}>{p.icon}</div>
                <div className={styles.coinAmount}>{p.amount} монет</div>
                <div className={styles.coinLabel}>{p.label}</div>
                <div className={styles.coinPrice}>{p.price} ₽</div>
                <button className={styles.buyBtn} onClick={() => buyCoins(p)}>Купить</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className={styles.historyList}>
            {history.length === 0 && <div className={styles.empty}>История пуста</div>}
            {history.map((h, i) => (
              <div key={i} className={styles.historyRow}>
                <div className={styles.historyIcon}>{h.type === 'purchase' ? '💰' : '🎁'}</div>
                <div className={styles.historyInfo}>
                  <span className={styles.historyDesc}>{h.description || h.type}</span>
                  <span className={styles.historyDate}>{new Date(h.createdAt).toLocaleDateString('ru')}</span>
                </div>
                <div className={`${styles.historyAmount} ${h.amount > 0 ? styles.plus : styles.minus}`}>
                  {h.amount > 0 ? '+' : ''}{h.amount}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {giftModal && (
        <div className={styles.overlay} onClick={() => setGiftModal(null)}>
          <div className={styles.giftModalBox} onClick={e => e.stopPropagation()}>
            <div className={styles.giftModalIcon}>{giftModal.emoji}</div>
            <div className={styles.giftModalName}>{giftModal.name}</div>
            <div className={styles.giftModalPrice}>Стоимость: 💰 {giftModal.price}</div>
            <input className={styles.giftModalInput}
              placeholder="@username получателя"
              value={giftTarget}
              onChange={e => setGiftTarget(e.target.value.replace('@', ''))}
              onKeyDown={e => e.key === 'Enter' && sendGift(giftModal, giftTarget)} />
            <div className={styles.giftModalBtns}>
              <button className={styles.cancelBtn} onClick={() => setGiftModal(null)}>Отмена</button>
              <button className={styles.sendGiftBtn} onClick={() => sendGift(giftModal, giftTarget)}>
                Отправить {giftModal.emoji}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
