import React from 'react'

const COLORS = [
  '#7c3aed','#2563eb','#0891b2','#059669',
  '#d97706','#dc2626','#db2777','#4f46e5',
  '#0d9488','#65a30d','#ea580c','#7c3aed',
]

function avatarColor(name) {
  if (!name) return COLORS[0]
  const sum = [...name].reduce((a, c) => a + c.charCodeAt(0), 0)
  return COLORS[sum % COLORS.length]
}

export default function Avatar({ name = '?', size = 38, src }) {
  const letter = (name[0] || '?').toUpperCase()
  const color = avatarColor(name)
  const fontSize = Math.max(10, Math.floor(size * 0.4))

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize,
      fontWeight: 700,
      color: '#fff',
      flexShrink: 0,
      userSelect: 'none',
      boxShadow: `0 2px 8px ${color}44`,
    }}>
      {letter}
    </div>
  )
}
