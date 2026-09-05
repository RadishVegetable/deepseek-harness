import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  ))
}

/** Keep keyboard focus inside an open Tavern dialog.
 * @param dialogRef - Root element of the dialog.
 * @param initialFocusRef - Element that receives focus when the dialog opens.
 * @param onEscape - Callback for a cancellable Escape key press.
 * @param canEscape - Whether Escape may close the dialog in the current state.
 * @param enabled - Whether focus should be moved and trapped for the current dialog layer.
 */
export function useTavernDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  canEscape: boolean,
  enabled = true,
): void {
  const onEscapeRef = useRef(onEscape)
  const canEscapeRef = useRef(canEscape)
  onEscapeRef.current = onEscape
  canEscapeRef.current = canEscape

  useEffect(() => {
    if (!enabled) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      const dialog = dialogRef.current
      if (dialog === null) return
      if (event.key === 'Escape' && canEscapeRef.current) {
        event.preventDefault()
        onEscapeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusableElements(dialog)
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (first === undefined || last === undefined) return
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (returnFocus !== null && document.contains(returnFocus)) returnFocus.focus()
    }
  }, [dialogRef, enabled, initialFocusRef])
}
