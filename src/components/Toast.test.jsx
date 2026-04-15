import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function ToastTrigger({ type = 'success', message = 'Test message' }) {
  const toast = useToast()
  return <button onClick={() => toast[type](message)}>Trigger</button>
}

describe('Toast', () => {
  it('shows a success toast when triggered', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )

    await act(async () => {
      screen.getByText('Trigger').click()
    })

    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('shows an error toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger type="error" message="Something failed" />
      </ToastProvider>
    )

    await act(async () => {
      screen.getByText('Trigger').click()
    })

    expect(screen.getByText('Something failed')).toBeInTheDocument()
  })
})
