/**
 * Detecção de desktop. A experiência é exclusiva para PC/notebook com teclado:
 * dispositivos touch-first, telas pequenas e user agents móveis são bloqueados.
 */
export function isDesktopExperience(): boolean {
  if (typeof window === 'undefined') return false

  const ua = navigator.userAgent
  const mobileUA = /android|iphone|ipad|ipod|windows phone|mobile|silk|kindle/i.test(ua)
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false
  const touchFirst = coarsePointer && noHover
  const smallScreen =
    Math.min(window.screen.width, window.screen.height) < 620 || window.innerWidth < 900

  return !mobileUA && !touchFirst && !smallScreen
}
