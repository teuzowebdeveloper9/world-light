# World of Light

Uma experiência 3D contemplativa para navegador: um pequeno mago de capa
atravessando um mundo procedural **infinito** de luz — sol gigante no
horizonte, god rays, partículas douradas, montanhas ao longe, árvores e grama
balançando ao vento. Feita para **computador** (teclado); celulares e tablets
veem uma tela de aviso.

> 🤖 Este projeto foi desenvolvido com **Claude Fable 5** (Anthropic), o
> modelo da família Claude 5, via Claude Code.

Stack: Vite · React 19 · TypeScript · Three.js · @react-three/fiber · drei ·
rapier (física) · postprocessing · simplex-noise · Zustand · Web Worker.

## Créditos do personagem

O mago é o modelo **Mage** do pacote
**[KayKit — Character Pack: Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)**,
criado por **[Kay Lousberg](https://kaylousberg.com)** ([itch.io](https://kaylousberg.itch.io/kaykit-adventurers)).
Licença **CC0** (domínio público — uso pessoal, educacional e comercial livre;
crédito opcional, mas merecido). A licença original acompanha o modelo em
`public/models/CHARACTER_LICENSE.txt`. O rig e as animações (Idle, Walk, Run,
Jump…) também são do pacote. Obrigado, Kay! 💛

## Mecânicas

- **Movimento** — WASD/setas movem relativo à câmera; a velocidade é dirigida
  por código (a cápsula de física tem atrito 0, então o terreno nunca "segura"
  o player). `Shift` corre (5.5 → 11 u/s) com aceleração suavizada e menos
  controle no ar.
- **Pulo e planagem** — `Espaço` pula com gravidade forte (-24, pulo com
  peso). Segurando `Espaço` durante a queda ele **plana** (queda limitada a
  -2.2) por até ~5s de "energia", que recarrega ao pousar. A gravidade sempre
  vence: não existe voo livre.
- **Chão garantido** — o grounded detection é *analítico*: a mesma função
  matemática que gera o terreno é amostrada na posição do player. Mesmo que um
  collider ainda não tenha montado, ele nunca cai pelo mundo. Em rampas, o
  modelo visual é puxado até a altura real do terreno (snap), então os pés
  sempre tocam o chão.
- **Animações** — crossfade automático entre Idle/Walk/Run/Jump conforme o
  estado físico; a cadência dos passos acompanha a velocidade real.
- **Manto ao vento** — meio-cilindro paramétrico (~220°) preso no anel dos
  ombros, animado por senos + rajadas globais; barra levanta e arrasta ao
  correr. Sem cloth simulation cara.
- **Câmera** — terceira pessoa baixa (o mundo parece gigante), órbita com
  `Q`/`E` ou arrasto do mouse, entrada cinematográfica em mergulho suave, e a
  câmera nunca entra no terreno.
- **Mundo infinito** — chunks determinísticos gerados em Web Worker com a
  regra dos 60% (detalhes abaixo).

---

## Como rodar

```bash
npm install
npm run dev        # http://localhost:5173
```

Build de produção:

```bash
npm run build
npm run preview    # serve o build em http://localhost:4173
```

---

## Onde colocar o áudio

A música deve ficar em:

```
public/audio/rain-lofi.mp3
```

> **O `.mp3` não é versionado no repositório** (direitos da faixa pertencem ao
> produtor — a trilha usada em desenvolvimento foi o beat gratuito
> *"Lo-fi Type Beat — Rain"* de **Lee**). Coloque qualquer `.mp3` seu com esse
> nome nessa pasta e a experiência o tocará. Sem o arquivo, tudo funciona —
> apenas sem música.

O áudio toca em **loop**, só começa **após a primeira tecla** (política de
autoplay dos navegadores), inicia com volume 0.35 e sempre entra/sai com
**fade suave**. A preferência ligada/desligada fica salva no `localStorage`.

---

## Controles

| Tecla | Ação |
| --- | --- |
| `W A S D` / setas | mover |
| `Shift` | correr |
| `Espaço` | pular · **segurar no ar = planar** (energia recarrega ao pousar) |
| `Q` / `E` ou arrastar o mouse | girar a câmera |
| `M` | ligar/desligar música |
| `H` | esconder/mostrar a ajuda |
| `Esc` | pausar/voltar |

---

## Como o algoritmo de chunks funciona

O mundo é dividido em chunks de `96×96` unidades (`CHUNK_SIZE`), gerados de
forma **determinística**: `seed global + coordenadas do chunk` sempre produzem
o mesmo terreno, as mesmas árvores, as mesmas pedras.

1. **Anel ativo** — um quadrado de raio 3 (`ACTIVE_RADIUS`, 7×7 chunks) é
   mantido ao redor do player. Chunks além do raio 5 (`UNLOAD_RADIUS`) são
   descartados com `dispose()` completo de geometrias e materiais.
2. **Regra dos 60%** (`PRELOAD_THRESHOLD`) — a posição local do player dentro
   do chunk é calculada com módulo positivo:

   ```ts
   const localX = positiveModulo(player.x, CHUNK_SIZE)
   if (localX > CHUNK_SIZE * 0.6) preload(direita)  // + diagonais
   if (localX < CHUNK_SIZE * 0.4) preload(esquerda)
   // idem para o eixo Z
   ```

   Ao cruzar 60% do chunk em direção a uma borda, a **próxima banda** de
   chunks naquela direção começa a gerar antes de o player chegar lá.
3. **Prioridade por velocidade** — a fila de geração é ordenada por distância
   **menos** um bônus na direção da velocidade: correndo, os chunks à frente
   são gerados primeiro (`chunkPriority`).
4. **Web Worker** — heightmap, normais analíticas, cores por vértice e
   distribuição de objetos rodam em `src/workers/chunkWorker.ts`. O worker
   devolve `Float32Array`s via **transferables** (zero cópia). A main thread
   aplica no máximo **2 resultados por frame** — nunca trava o render.
5. **Sem buracos, sem quedas** — as normais são calculadas analiticamente da
   mesma função de altura (iluminação contínua entre chunks), cada chunk tem
   uma "saia" nas bordas, e o player usa **detecção de chão analítica**: mesmo
   que um collider ainda não tenha montado, ele nunca atravessa o terreno.
6. **Física local** — colliders trimesh existem **apenas** no 3×3 ao redor do
   player (`PHYSICS_RADIUS`), reutilizando os buffers da própria renderização.

Cada chunk contém: terreno colorido por vértice (campina, trilhas de areia,
rocha, picos claros), árvores e pedras instanciadas, grama com vento em
shader, e raramente um obelisco de luz que brilha no bloom.

## Otimizações aplicadas

- **Web Worker + transferables** para toda a geração procedural
- **Fila com prioridade** e orçamento de 2 chunks aplicados por frame
- **InstancedMesh** para árvores, pedras e grama (1 draw call por tipo/chunk)
- **LOD por anel**: grama só no anel 1; árvore detalhada até o anel 2 e
  cone-silhueta além; sombras dinâmicas só no anel 1
- **Vento em shader** via `onBeforeCompile` com **uma única uniform global**
  (um update por frame move grama e árvores do mundo todo)
- **Materiais e geometrias compartilhados** por fábricas; clones por chunk só
  durante o fade-in (e `transparent` é desligado ao terminar)
- **Dispose completo** (geometria + materiais) ao descartar chunks — sem leaks
- **Bounding spheres manuais** por chunk (frustum culling sem varrer vértices)
- **DPR limitado a 1.5** + `PerformanceMonitor` (cai para 1.0 sob carga)
- **Canvas sem MSAA** — antialias via SMAA no composer (mais barato)
- Sombras com frustum apertado (±95) **seguindo o player**, mapa 2048
- Partículas com **limite fixo** (1200) e wrap ao redor da câmera — custo
  constante, zero alocação por frame
- Estado de alta frequência fora do React (refs mutáveis) — re-render de
  componentes só em eventos discretos (troca de chunk, pausa, etc.)
- Céu, sol e montanhas-silhueta do horizonte **em shader** (custo ~zero)

## Estrutura

```
src/
  app/           bootstrap + CSS global
  experience/    gate desktop-only, tela inicial, HUD, Canvas
  world/         chunks: manager, terreno, noise, bioma, spawner
  workers/       chunkWorker (geração) + cliente com fila de prioridade
  player/        física do player, câmera, capa ao vento, input
  visuals/       sol, céu, partículas, materiais, pós-processamento
  physics/       mundo Rapier + collider de terreno
  audio/         música em loop com fades
  state/         store Zustand
  utils/         math, device, dispose
public/
  audio/rain-lofi.mp3
  models/character.glb   ← KayKit Adventurers (Mago), licença CC0
```

**Créditos do modelo:** personagem do pacote
[KayKit — Character Pack: Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)
de Kay Lousberg, licença **CC0** (uso livre, crédito opcional — licença em
`public/models/CHARACTER_LICENSE.txt`).

## Próximos passos para o visual

- Cloth simulation Verlet real para a capa (constraints de distância)
- Nuvens volumétricas leves (raymarch barato num quad no horizonte)
- Água: lagos low-poly com reflexo do sol nos vales entre montanhas
- Vaga-lumes/luzes noturnas + ciclo de dia/noite lento
- Footsteps: partículas de poeira e sons de passos por bioma
- Pós: SSAO leve no anel próximo, depth of field sutil no horizonte
- Streaming de detalhe: re-gerar chunks do anel 1 com resolução maior
