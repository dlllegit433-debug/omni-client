import React, { useState } from 'react'
import { post } from '../lib/api'
import useStore, { applyTheme } from '../store/useStore'
import styles from './AuthPage.module.css'

export default function AuthPage() {
  const [tab, setTab] = useState('login') // login | register | admin
  const { setAuth } = useStore()

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>Ω</div>
          <span className={styles.logoText}>Omni</span>
        </div>

        <div className={styles.tabs}>
          {['login', 'register', 'admin'].map(t => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'login' ? 'Войти' : t === 'register' ? 'Регистрация' : 'Админ'}
            </button>
          ))}
        </div>

        {tab === 'login' && <LoginForm setAuth={setAuth} />}
        {tab === 'register' && <RegisterForm setAuth={setAuth} />}
        {tab === 'admin' && <AdminForm setAuth={setAuth} />}
      </div>
    </div>
  )
}

function LoginForm({ setAuth }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username || !password) return setError('Заполните все поля')
    setLoading(true); setError('')
    try {
      const res = await post('/api/auth/login', { json: { username, password } })
      if (res.ok) {
        if (res.data.adminPending) {
          setError('Используйте вкладку Админ для входа как администратор')
          setLoading(false)
          return
        }
        await finishAuth(res.data, setAuth)
      } else {
        setError(res.data.error || `Ошибка ${res.status}`)
      }
    } catch (e) {
      setError('Ошибка соединения с сервером')
    }
    setLoading(false)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input label="Логин" value={username} onChange={setUsername} placeholder="username" />
      <Input label="Пароль" value={password} onChange={setPassword} type="password" placeholder="••••••••" />
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.btn} disabled={loading}>
        {loading ? <Spinner /> : 'Войти'}
      </button>
    </form>
  )
}

function RegisterForm({ setAuth }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username || !password) return setError('Заполните обязательные поля')
    if (password !== password2) return setError('Пароли не совпадают')
    if (password.length < 8) return setError('Пароль минимум 8 символов')
    setLoading(true); setError('')
    try {
      const res = await post('/api/auth/register', {
        json: { username, password, displayName: displayName || username }
      })
      if (res.ok) {
        await finishAuth(res.data, setAuth)
      } else {
        setError(res.data.error || `Ошибка ${res.status}`)
      }
    } catch {
      setError('Ошибка соединения с сервером')
    }
    setLoading(false)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input label="Логин *" value={username} onChange={setUsername} placeholder="username" />
      <Input label="Отображаемое имя" value={displayName} onChange={setDisplayName} placeholder="Имя в чате" />
      <Input label="Пароль *" value={password} onChange={setPassword} type="password" placeholder="Минимум 8 символов" />
      <Input label="Повторите пароль *" value={password2} onChange={setPassword2} type="password" placeholder="••••••••" />
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.btn} disabled={loading}>
        {loading ? <Spinner /> : 'Создать аккаунт'}
      </button>
    </form>
  )
}

function AdminForm({ setAuth }) {
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState(1)
  const [requestId, setRequestId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleStep1(e) {
    e.preventDefault()
    if (!username) return setError('Введите логин администратора')
    setLoading(true); setError('')
    try {
      const res = await post('/api/auth/login', { json: { username, password: '' } })
      if (res.status === 200 && res.data.adminPending) {
        setRequestId(res.data.requestId)
        setStep(2)
        setError('⏳ Код отправлен в логи сервера')
      } else if (res.ok && res.data.token) {
        await finishAuth(res.data, setAuth)
      } else {
        setError(res.data.error || 'Ошибка')
      }
    } catch {
      setError('Ошибка соединения')
    }
    setLoading(false)
  }

  async function handleStep2(e) {
    e.preventDefault()
    if (!code) return setError('Введите код')
    setLoading(true); setError('')
    try {
      const res = await post('/api/auth/admin-verify', { json: { requestId, code: code.trim() } })
      if (res.ok) {
        await finishAuth(res.data, setAuth)
      } else {
        setError(res.data.error || 'Неверный код')
      }
    } catch {
      setError('Ошибка соединения')
    }
    setLoading(false)
  }

  return (
    <form className={styles.form} onSubmit={step === 1 ? handleStep1 : handleStep2}>
      {step === 1 ? (
        <Input label="Логин администратора" value={username} onChange={setUsername} placeholder="admin" />
      ) : (
        <Input label="Код подтверждения (из логов сервера)" value={code} onChange={setCode} placeholder="123456" />
      )}
      {error && <p className={error.startsWith('⏳') ? styles.info : styles.error}>{error}</p>}
      <button className={styles.btn} disabled={loading}>
        {loading ? <Spinner /> : step === 1 ? 'Получить код' : 'Подтвердить'}
      </button>
    </form>
  )
}

async function finishAuth(data, setAuth) {
  const { token, ...me } = data
  setAuth(token, me)
  applyTheme(me.theme || 'violet')
  if (window.electron) {
    await window.electron.config.save({ token })
  } else {
    localStorage.setItem('omni_session', JSON.stringify({ token }))
  }
}

function Input({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input
        className={styles.input}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'current-password' : 'off'}
      />
    </div>
  )
}

function Spinner() {
  return <span className={styles.spinner} />
}
