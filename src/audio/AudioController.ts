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
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private target = 0
  private unlockAttached = false

  /**
   * Rede de segurança contra autoplay: se o primeiro play() falhar por
   * qualquer razão (política do browser, race), QUALQUER tecla ou clique
   * seguinte tenta de novo — a música nunca fica presa no silêncio.
   */
  private attachUnlock(): void {
    if (this.unlockAttached) return
    this.unlockAttached = true
    const retry = () => {
      const el = this.el
      if (el && this.target > 0 && el.paused) {
        el.play().catch(() => {})
      }
    }
    window.addEventListener('keydown', retry)
    window.addEventListener('pointerdown', retry)
  }

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
    this.attachUnlock()
    if (musicOn) {
      el.play().catch(() => {
        // Arquivo ausente ou autoplay bloqueado: o unlock listener tenta de novo.
      })
      this.fadeTo(TARGET_VOLUME)
    }
  }

  setEnabled(on: boolean): void {
    const el = this.ensureElement()
    this.attachUnlock()
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
    if (this.fadeTimer) clearInterval(this.fadeTimer)
    let last = performance.now()
    // setInterval (e não rAF): continua rodando mesmo com a aba em segundo
    // plano — o fade nunca fica preso no volume 0.
    this.fadeTimer = setInterval(() => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now
      const step = (TARGET_VOLUME / FADE_SECONDS) * dt
      const diff = this.target - el.volume
      if (Math.abs(diff) <= step) {
        el.volume = this.target
        if (this.fadeTimer) clearInterval(this.fadeTimer)
        this.fadeTimer = null
        onDone?.()
        return
      }
      el.volume = Math.min(1, Math.max(0, el.volume + Math.sign(diff) * step))
    }, 50)
  }
}

export const audioController = new AudioController()
