/**
 * Efeitos sonoros procedurais via WebAudio — passos, pulo e pouso gerados
 * por rajadas de ruído filtrado (nenhum asset binário extra no repo).
 * O AudioContext nasce no primeiro gesto do usuário (política de autoplay);
 * se estiver suspenso, os sons simplesmente não tocam — nunca quebram.
 */

const MASTER_VOLUME = 0.5

class SfxController {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null

  /** Chame dentro de um handler de interação do usuário. */
  unlock(): void {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = MASTER_VOLUME
        this.master.connect(this.ctx.destination)
        const len = Math.floor(this.ctx.sampleRate * 0.25)
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const data = this.noiseBuffer.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      } catch {
        this.ctx = null
      }
    }
    return this.ctx
  }

  private noiseBurst(
    duration: number,
    filterFreq: number,
    peak: number,
    playbackRate = 1
  ): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || !this.noiseBuffer || ctx.state !== 'running') return
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.playbackRate.value = playbackRate
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFreq
    const gain = ctx.createGain()
    const t = ctx.currentTime
    gain.gain.setValueAtTime(peak, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    src.start(t)
    src.stop(t + duration)
  }

  /** Passo suave; pitch aleatório evita o efeito "metralhadora". */
  footstep(intensity: number): void {
    const pitch = 0.8 + Math.random() * 0.4
    this.noiseBurst(0.09, 650 + intensity * 550, 0.025 + intensity * 0.05, pitch)
  }

  /** "Puff" curto e agudo ao saltar. */
  jump(): void {
    this.noiseBurst(0.16, 1300, 0.035, 1.3)
  }

  /** Baque no pouso: ruído grave + thump senoidal, escala com a queda. */
  land(intensity: number): void {
    this.noiseBurst(0.15, 480, 0.045 + intensity * 0.09)
    const ctx = this.ctx
    if (!ctx || !this.master || ctx.state !== 'running') return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(95, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    gain.gain.setValueAtTime(0.05 + intensity * 0.08, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.15)
  }
}

export const sfxController = new SfxController()
