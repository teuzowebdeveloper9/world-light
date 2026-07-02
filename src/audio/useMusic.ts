/**
 * Sincroniza a preferência de música (store) com o AudioController.
 */
import { useEffect, useRef } from 'react'
import { useExperienceStore } from '../state/useExperienceStore'
import { audioController } from './AudioController'

export function useMusic(): void {
  const musicOn = useExperienceStore((s) => s.musicOn)
  const phase = useExperienceStore((s) => s.phase)
  const started = useRef(false)

  useEffect(() => {
    // A primeira transição para 'entering' acontece dentro de um keydown —
    // contexto válido para iniciar o áudio.
    if (!started.current && (phase === 'entering' || phase === 'playing')) {
      started.current = true
      audioController.start(useExperienceStore.getState().musicOn)
      return
    }
    if (started.current) {
      audioController.setEnabled(musicOn)
    }
  }, [musicOn, phase])
}
