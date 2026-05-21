import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, Btn, Input, EmptyState, Avatar, ProgressBar } from './UI'

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge color="green">Activo</Badge>)
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('uses gray style for unknown color', () => {
    const { container } = render(<Badge color="unknown">Test</Badge>)
    expect(container.querySelector('span')).toBeInTheDocument()
  })
})

describe('Btn', () => {
  it('renders with children', () => {
    render(<Btn>Click me</Btn>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Btn disabled>Disabled</Btn>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('has correct type', () => {
    render(<Btn type="submit">Submit</Btn>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })
})

describe('Input', () => {
  it('renders label and input', () => {
    render(<Input label="Email" id="email" />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows error with aria-invalid', () => {
    render(<Input label="Name" id="name" error="Required" />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Required')).toBeInTheDocument()
  })

  it('links error via aria-describedby', () => {
    render(<Input label="Name" id="name" error="Required" />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-describedby', 'name-error')
  })
})

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="Try again" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})

describe('Avatar', () => {
  it('renders initials when no imgUrl', () => {
    const { container } = render(<Avatar nombre="Juan Pérez" size={44} />)
    expect(container.textContent).toBe('JP')
  })

  it('renders initials when imgUrl is empty', () => {
    const { container } = render(<Avatar nombre="Ana B" size={44} imgUrl="" />)
    expect(container.textContent).toBe('AB')
  })

  it('renders img when imgUrl is valid https', () => {
    // El <img> tiene alt="" intencional (para no exponer nombre en imagen rota)
    // así que role="img" no aplica — buscamos por aria-label que sí está puesto
    const { container } = render(<Avatar nombre="Test" size={44} imgUrl="https://example.com/photo.jpg" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe('https://example.com/photo.jpg')
    expect(img.getAttribute('aria-label')).toBe('Test')
  })

  it('does NOT render img for javascript: URLs', () => {
    const { container } = render(<Avatar nombre="Hack" size={44} imgUrl="javascript:alert(1)" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('H')
  })

  it('does NOT render img for vbscript: or data:text/html URLs', () => {
    const { container: c1 } = render(<Avatar nombre="A B" imgUrl="vbscript:msgbox(1)" />)
    expect(c1.querySelector('img')).toBeNull()
    const { container: c2 } = render(<Avatar nombre="A B" imgUrl="data:text/html,<script>alert(1)</script>" />)
    expect(c2.querySelector('img')).toBeNull()
  })
})

describe('ProgressBar', () => {
  it('renders with correct aria attributes', () => {
    render(<ProgressBar value={50} max={100} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })
})
