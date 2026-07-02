/**
 * Pós-processamento cinematográfico:
 * - GodRays a partir do sol (os "raios fortes atravessando o mundo")
 * - Bloom seletivo (só materiais HDR: sol, obeliscos, partículas)
 * - SMAA (o Canvas roda sem MSAA para o composer ser mais barato)
 * - Vignette sutil + tone mapping ACES
 */
import {
  Bloom,
  EffectComposer,
  GodRays,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction, KernelSize, ToneMappingMode } from 'postprocessing'
import type * as THREE from 'three'

interface PostProcessingProps {
  sun: THREE.Mesh | null
}

export function PostProcessing({ sun }: PostProcessingProps) {
  return (
    <EffectComposer multisampling={0}>
      {sun ? (
        <GodRays
          sun={sun}
          blendFunction={BlendFunction.SCREEN}
          samples={48}
          density={0.96}
          decay={0.93}
          weight={0.22}
          exposure={0.18}
          clampMax={1}
          kernelSize={KernelSize.SMALL}
          blur
        />
      ) : (
        <></>
      )}
      <Bloom
        mipmapBlur
        intensity={0.55}
        luminanceThreshold={0.95}
        luminanceSmoothing={0.25}
      />
      <SMAA />
      <Vignette eskil={false} offset={0.22} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
