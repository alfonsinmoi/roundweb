// ─── Round Design System ───

export function Card({ children, className = '', style = {}, ...props }) {
  return (
    <div className={className}
         style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, ...style }}
         {...props}>
      {children}
    </div>
  )
}

const badgeStyles = {
  green:  { bg: 'var(--green-bg)',  fg: 'var(--green)',  border: 'var(--green-border)' },
  blue:   { bg: 'var(--blue-bg)',   fg: 'var(--blue)',   border: 'var(--blue-border)' },
  red:    { bg: 'rgba(248,113,113,0.07)', fg: 'var(--red)',  border: 'rgba(248,113,113,0.16)' },
  yellow: { bg: 'rgba(251,191,36,0.07)',  fg: 'var(--amber)', border: 'rgba(251,191,36,0.16)' },
  orange: { bg: 'rgba(251,146,60,0.07)',  fg: '#FB923C',      border: 'rgba(251,146,60,0.16)' },
  purple: { bg: 'rgba(167,139,250,0.07)', fg: 'var(--violet)', border: 'rgba(167,139,250,0.16)' },
  gray:   { bg: 'rgba(130,130,143,0.07)', fg: 'var(--text-2)', border: 'rgba(130,130,143,0.12)' },
}

export function Badge({ children, color = 'green' }) {
  const s = badgeStyles[color] ?? badgeStyles.gray
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 10,
      fontSize: 12, fontWeight: 500, lineHeight: 1,
      background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
    }}>
      {children}
    </span>
  )
}

export function StatCard({ label, value, sub, icon: Icon, color = 'var(--green)' }) {
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 20, padding: '28px 24px' }}>
      {Icon && (
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${color} 10%, transparent)`,
          marginBottom: 24,
        }}>
          <Icon size={20} style={{ color }} aria-hidden="true" />
        </div>
      )}
      <p style={{ fontFamily: 'Outfit', fontSize: 40, fontWeight: 700, color: 'var(--text-0)', lineHeight: 1, letterSpacing: '-0.02em' }}>
        {value}
      </p>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginTop: 12 }}>{label}</p>
      {sub && <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>{sub}</p>}
    </div>
  )
}

export function Table({ columns, data, onRowClick, ariaLabel }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: 20, border: '1px solid var(--line)' }} role="region" aria-label={ariaLabel} tabIndex={0}>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-1)' }}>
            {columns.map(col => (
              <th key={col.key} scope="col" style={{
                padding: '16px 20px', textAlign: 'left', fontSize: 12, fontWeight: 500,
                color: 'var(--text-3)', borderBottom: '1px solid var(--line)',
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)' }}>
              Sin resultados
            </td></tr>
          )}
          {data.map((row, i) => (
            <tr key={row.id ?? i}
                onClick={() => onRowClick?.(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={e => { if (e.key === 'Enter' && onRowClick) onRowClick(row) }}
                className={onRowClick ? 'interactive-row' : ''}
                style={{
                  borderBottom: i < data.length - 1 ? '1px solid var(--line)' : 'none',
                  cursor: onRowClick ? 'pointer' : 'default', transition: 'background 0.1s',
                }}>
              {columns.map(col => (
                <td key={col.key} style={{ padding: '16px 20px', color: 'var(--text-1)' }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled = false, type = 'button', className = '', style: extraStyle = {} }) {
  const variants = {
    primary:   { background: 'var(--gradient-primary)', color: '#fff', border: 'none' },
    secondary: { background: 'var(--bg-3)', color: 'var(--text-1)', border: '1px solid var(--line-2)' },
    danger:    { background: 'rgba(248,113,133,0.08)', color: 'var(--red)', border: '1px solid rgba(248,113,133,0.16)' },
    ghost:     { background: 'transparent', color: 'var(--text-2)', border: 'none' },
  }
  const sizes = {
    sm: { padding: '10px 18px', fontSize: 13 },
    md: { padding: '14px 24px', fontSize: 14 },
    lg: { padding: '18px 32px', fontSize: 15 },
  }
  const v = variants[variant]
  const s = sizes[size]
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn ${className}`}
            style={{
              ...v, ...s, ...extraStyle,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              borderRadius: 14, fontWeight: 600, fontFamily: 'Outfit, sans-serif',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.35 : 1,
              transition: 'filter 0.15s, transform 0.15s',
            }}>
      {children}
    </button>
  )
}

export function Input({ label, id, error, ...props }) {
  const errorId = error ? `${id}-error` : undefined
  return (
    <div>
      {label && <label htmlFor={id} style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--text-2)', marginBottom: 10 }}>{label}</label>}
      <input id={id}
             aria-invalid={error ? 'true' : undefined}
             aria-describedby={errorId}
             className="form-input"
             style={{
               width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 15,
               background: 'var(--bg-1)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
               color: 'var(--text-0)', transition: 'border-color 0.15s',
             }}
             {...props} />
      {error && <p id={errorId} role="alert" style={{ fontSize: 13, marginTop: 8, color: 'var(--red)' }}>{error}</p>}
    </div>
  )
}

export function Select({ label, id, children, error, ...props }) {
  const errorId = error ? `${id}-error` : undefined
  return (
    <div>
      {label && <label htmlFor={id} style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--text-2)', marginBottom: 10 }}>{label}</label>}
      <select id={id}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={errorId}
              className="form-input"
              style={{
                width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 15,
                background: 'var(--bg-1)', border: `1px solid ${error ? 'var(--red)' : 'var(--line)'}`,
                color: 'var(--text-0)', cursor: 'pointer', transition: 'border-color 0.15s',
              }}
              {...props}>{children}</select>
      {error && <p id={errorId} role="alert" style={{ fontSize: 13, marginTop: 8, color: 'var(--red)' }}>{error}</p>}
    </div>
  )
}

export function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
      <h2 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 600, color: 'var(--text-0)' }}>
        {children}
      </h2>
      {action}
    </div>
  )
}

// Validate imgUrl: only render if it looks like a safe HTTPS URL
function isSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function Avatar({ nombre, size = 44, imgUrl }) {
  const initials = nombre?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const hues = ['#2DD4A8','#5B9CF6','#A78BFA','#FBBF24','#FB923C','#FB7185']
  const c = hues[(nombre?.charCodeAt(0) ?? 0) % hues.length]
  if (isSafeImageUrl(imgUrl)) {
    return <img src={imgUrl} alt={nombre ?? ''} style={{ width: size, height: size, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: 14, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in srgb, ${c} 14%, var(--bg-3))`,
      color: c, fontSize: size * 0.32, fontWeight: 600, fontFamily: 'Outfit',
    }}>
      {initials}
    </div>
  )
}

export function ProgressBar({ value = 0, max = 100, color = 'var(--green)', height = 4 }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}
         style={{ width: '100%', height, borderRadius: 99, overflow: 'hidden', background: 'var(--bg-4)' }}>
      <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: color, transition: 'width 0.4s ease' }} />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
      {Icon && <Icon size={32} style={{ color: 'var(--text-3)', marginBottom: 16 }} aria-hidden="true" />}
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-2)' }}>{title}</p>
      {description && <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 8, maxWidth: 360 }}>{description}</p>}
    </div>
  )
}
