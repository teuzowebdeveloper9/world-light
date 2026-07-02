/**
 * Controle da trilha sonora em loop.
 * - Só inicia após a primeira interação de teclado (política de autoplay).
 * - Fade-in/out suave via rAF (nunca corta seco).
 * - Preferência salva em localStorage (feita no store).
 */
const TARGET_VOLUME = 0.35
const FADE_SECONDS = 2.2

class AudioController {
  private el: HTMLAudioElement | null = null
  private raf = 0
  private target = 0

  private ensureElement(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio(`${import.meta.env.BASE_URL}audio/rain-lofi.mp3`)
      this.el.loop = true
      this.el.preload = 'auto'
      this.el.volume = 0
    }
    return this.el
  }

  /** Chame dentro de um handler de interação do usuário. */
  start(musicOn: boolean): void {
    const el = this.ensureElement()
    if (musicOn) {
      el.play().catch(() => {
        // Arquivo ausente ou autoplay bloqueado: a experiência segue sem música.
      })
      this.fadeTo(TARGET_VOLUME)
    }
  }

  setEnabled(on: boolean): void {
    const el = this.ensureElement()
    if (on) {
      if (el.paused) {
        el.play().catch(() => {})
      }
      this.fadeTo(TARGET_VOLUME)
    } else {
      this.fadeTo(0, () => el.pause())
    }
  }

  private fadeTo(volume: number, onDone?: () => void): void {
    const el = this.ensureElement()
    this.target = volume
    cancelAnimationFrame(this.raf)
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const step = (TARGET_VOLUME / FADE_SECONDS) * dt
      const diff = this.target - el.volume
      if (Math.abs(diff) <= step) {
        el.volume = this.target
        onDone?.()
        return
      }
      el.volume += Math.sign(diff) * step
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }
}

export const audioController = new AudioController()
