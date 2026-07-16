/**
 * Verificação de ponta a ponta dos encontros (princesa, sábio, lobo) usando
 * Playwright headless (mesma técnica do screenshots.mjs) com os gatilhos
 * encurtados via query params: ?sageAt=6&wolfAt=40 (segundos ANDADOS).
 *
 * Uso: node scripts/verify-npcs.mjs [pasta-de-saida]
 *
 * O terreno procedural pode travar (encosta íngreme) ou desviar uma
 * caminhada em linha reta — por isso o teste DIRIGE de verdade: mira a
 * câmera no alvo via __cameraRig (W anda para onde a câmera olha) e, se o
 * player ficar preso, pula e vira até desprender. Os hooks __playerState,
 * __npcState, __princessPos/__princessGone, __sagePos e __wolfStage/__wolfPos
 * são expostos pelos componentes só em DEV.
 *
 * Obs.: com SwiftShader o FPS é baixo e o dt do jogo é clampado em 0.05s —
 * o tempo de jogo passa mais devagar que o relógio; os timeouts são largos.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = 5223
const BASE = `http://localhost:${PORT}`
const OUT = (process.argv[2] || new URL('./.npc-verify/', import.meta.url).pathname).replace(/\/?$/, '/')

mkdirSync(OUT, { recursive: true })

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
})
const stopVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM')
  } catch {
    /* já morreu */
  }
}
process.on('exit', stopVite)

for (let i = 0; i < 60; i++) {
  try {
    await fetch(BASE)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let failed = false
const fail = (msg) => {
  console.error('✗ ' + msg)
  failed = true
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))

  const walkTime = () => page.evaluate(() => window.__npcState?.walkTime ?? 0)
  const playerPos = () =>
    page.evaluate(() => {
      const p = window.__playerState.position
      return { x: p.x, z: p.z }
    })
  /** Mira a câmera num ponto do mundo: W passa a andar na direção dele. */
  const aimAt = (tx, tz) =>
    page.evaluate(
      ([x, z]) => {
        const p = window.__playerState.position
        window.__cameraRig.yaw = Math.atan2(-(x - p.x), -(z - p.z))
      },
      [tx, tz]
    )
  const shot = async (name) => {
    await page.screenshot({ path: OUT + name })
    console.log('✓ ' + name)
  }

  /**
   * Anda (W+Shift) até doneCheck() ser verdade, re-mirando a cada volta via
   * update() e desprendendo de encostas se parar de render. O sinal de
   * "preso" é o PROGRESSO DO walkTime, não o deslocamento: encalhado num
   * paredão o corpo sem atrito OSCILA (desliza e volta) — a posição muda o
   * tempo todo, mas o tempo andado congela. Depois de um destrave, SEGURA
   * o desvio por alguns segundos antes de voltar a mirar o alvo — senão a
   * mira joga o player de volta no mesmo paredão para sempre.
   */
  async function walkUntil(doneCheck, update, timeoutMs) {
    await page.keyboard.down('KeyW')
    await page.keyboard.down('ShiftLeft')
    const t0 = Date.now()
    let lastWt = await walkTime()
    let lastProgress = Date.now()
    let detourUntil = 0
    let ok = false
    while (Date.now() - t0 < timeoutMs) {
      if (await doneCheck()) {
        ok = true
        break
      }
      if (update && Date.now() > detourUntil) await update()
      await page.waitForTimeout(700)
      const wt = await walkTime()
      if (wt > lastWt + 0.5) {
        lastWt = wt
        lastProgress = Date.now()
      } else if (Date.now() - lastProgress > 9000) {
        // Preso: pula, dá quase meia-volta e mantém o desvio um tempo.
        await page.keyboard.press('Space')
        await page.evaluate(() => {
          window.__cameraRig.yaw += 2.4
        })
        detourUntil = Date.now() + 6000
        lastProgress = Date.now()
      }
    }
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.up('KeyW')
    return ok
  }

  await page.goto(`${BASE}/?sageAt=6&wolfAt=40`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Entra no mundo e espera a fase de jogo.
  await page.keyboard.press('KeyK')
  await page.waitForSelector('.help-panel', { timeout: 90000 })

  // ---- Princesa: espera parada até o FIM da intro da câmera, depois
  // foge para sempre — o teste espera a fuga de verdade acontecer. ----
  const princessDist = () =>
    page.evaluate(() => {
      const a = window.__princessPos
      const p = window.__playerState.position
      return a ? Math.hypot(a.x - p.x, a.z - p.z) : null
    })
  await page.waitForTimeout(2500)
  await shot('npc-01-princess-wait.png')
  const d1 = await princessDist()
  if (d1 === null) {
    fail('princesa nunca montou (__princessPos ausente)')
  } else {
    // Intro (~6s de jogo) + espera de 2.5s viram MINUTOS de relógio no
    // SwiftShader (~10-25x); espera a distância crescer de verdade.
    let d2 = d1
    const t0 = Date.now()
    while (Date.now() - t0 < 300000) {
      d2 = (await princessDist()) ?? d2
      const goneEarly = await page.evaluate(() => window.__princessGone === true)
      if (goneEarly || d2 > d1 + 8) break
      await page.waitForTimeout(1500)
    }
    await shot('npc-02-princess-flee.png')
    console.log(`  princesa: ${d1.toFixed(1)}m -> ${d2.toFixed(1)}m`)
    if (!(d2 > d1 + 8)) fail('princesa não fugiu (distância não cresceu)')
  }

  // ---- Sábio: acumula 6s andados -> pilar -> dirige ATÉ ele -> H. ----
  if (!(await walkUntil(async () => (await walkTime()) >= 6, null, 180000))) {
    fail('walkTime nunca chegou a 6s (sábio)')
  }
  await page.waitForTimeout(1200)
  await shot('npc-03-sage-pillar.png')

  const sageNear = () =>
    page.evaluate(() => {
      const s = window.__sagePos
      if (!s) return false
      const p = window.__playerState.position
      return Math.hypot(s.x - p.x, s.z - p.z) < 6
    })
  // Além de mirar, solta o Shift perto do alvo: a 11 u/s com polls de
  // 700ms o player ORBITA o sábio sem nunca amostrar dentro do raio.
  const steerToSage = async () => {
    const d = await page.evaluate(() => {
      const s = window.__sagePos
      if (!s) return Infinity
      const p = window.__playerState.position
      window.__cameraRig.yaw = Math.atan2(-(s.x - p.x), -(s.z - p.z))
      return Math.hypot(s.x - p.x, s.z - p.z)
    })
    if (d < 18) await page.keyboard.up('ShiftLeft')
    else await page.keyboard.down('ShiftLeft')
  }
  const sageDist = () =>
    page.evaluate(() => {
      const s = window.__sagePos
      if (!s) return Infinity
      const p = window.__playerState.position
      return Math.hypot(s.x - p.x, s.z - p.z)
    })
  // Caminhar 100m de montanha procedural com um bot é loteria (4 rodadas de
  // ajuste provaram) — e pathfinding não é o que se verifica aqui. O bot se
  // MATERIALIZA a 3.5m do sábio (__teleport, DEV-only) e testa a mecânica:
  // vulto -> present -> prompt -> H -> diálogo -> avanço.
  {
    // A chegada leva 2.6s de JOGO (~26s+ de relógio a 2fps no SwiftShader).
    await page
      .waitForFunction(() => window.__sageStage === 'present', null, { timeout: 240000 })
      .catch(() => console.log('  (sábio ainda em arriving após 240s)'))
    await page.evaluate(() => {
      const s = window.__sagePos
      const p = window.__playerState.position
      const dx = p.x - s.x
      const dz = p.z - s.z
      const d = Math.hypot(dx, dz) || 1
      window.__teleport(s.x + (dx / d) * 3.5, s.z + (dz / d) * 3.5)
    })
    await page.waitForTimeout(2500)
    console.log(`  distância final até o sábio: ${(await sageDist()).toFixed(1)}m`)
    const prompt = await page.waitForSelector('.npc-prompt', { timeout: 30000 }).catch(() => null)
    if (!prompt) {
      const diag = await page.evaluate(() => ({
        stage: window.__sageStage,
        dist: window.__sageDist,
        prompt: window.__store?.getState?.().sagePromptVisible,
        dialog: window.__store?.getState?.().sageDialogIndex,
        paused: window.__store?.getState?.().paused,
      }))
      fail('prompt "falar com o Sábio" não apareceu perto dele — diag: ' + JSON.stringify(diag))
    } else {
      await page.waitForTimeout(600)
      await shot('npc-04-sage-prompt.png')
      await page.keyboard.press('KeyH')
      const box = await page.waitForSelector('.dialog-box', { timeout: 5000 }).catch(() => null)
      if (!box) fail('diálogo não abriu com H')
      await shot('npc-05-sage-dialog.png')
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('KeyH')
        await page.waitForTimeout(400)
      }
      await shot('npc-06-sage-dialog-4.png')
      const idx = await page.evaluate(() => document.querySelector('.dialog-hint')?.textContent)
      console.log('  diálogo em:', idx)
      if (!idx?.includes('4/50')) fail(`esperava fala 4/50, HUD diz: ${idx}`)
    }
  }

  // ---- Lobo: acumula 40s andados; para; vira a câmera; deixa alcançar. ----
  // Preso de frente num paredão o player OSCILA (desliza e volta): posição
  // muda, mas walkTime não cresce — o destrave aqui é por PROGRESSO do
  // walkTime, não por deslocamento.
  {
    await page.keyboard.down('KeyW')
    await page.keyboard.down('ShiftLeft')
    const t0 = Date.now()
    let lastWt = await walkTime()
    let lastProgress = Date.now()
    let ok = false
    while (Date.now() - t0 < 420000) {
      const wt = await walkTime()
      if (wt >= 40) {
        ok = true
        break
      }
      if (wt > lastWt + 0.8) {
        lastWt = wt
        lastProgress = Date.now()
      } else if (Date.now() - lastProgress > 15000) {
        // 15s sem andar de verdade: dá meia-volta e segue por outro caminho.
        await page.keyboard.press('Space')
        await page.evaluate(() => {
          window.__cameraRig.yaw += 2.6
        })
        lastProgress = Date.now()
      }
      await page.waitForTimeout(700)
    }
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.up('KeyW')
    if (!ok) fail('walkTime nunca chegou a 40s (lobo)')
  }
  const spawned = await page
    .waitForFunction(() => window.__wolfStage === 'chasing', null, { timeout: 30000 })
    .catch(() => null)
  if (!spawned) {
    fail('o lobo nunca entrou em perseguição')
  } else {
    // Olha para o caçador chegando.
    await page.evaluate(() => {
      const w = window.__wolfPos
      const p = window.__playerState.position
      if (w) window.__cameraRig.yaw = Math.atan2(-(w.x - p.x), -(w.z - p.z))
    })
    await page.waitForTimeout(2500)
    await shot('npc-07-wolf-coming.png')

    const black = await page
      .waitForSelector('.blackout-active', { timeout: 240000 })
      .catch(() => null)
    if (!black) {
      fail('o apagão do lobo nunca disparou')
    } else {
      await page.waitForTimeout(2200)
      await shot('npc-08-blackout.png')
      // Com o overlay preto o SwiftShader despenca para ~1-2 fps e os 2.6s
      // de jogo do timer viram DEZENAS de segundos de relógio — folga larga.
      const back = await page
        .waitForSelector('.blackout:not(.blackout-active)', { timeout: 240000 })
        .catch(() => null)
      if (!back) fail('o apagão nunca reabriu')
      await page.waitForTimeout(6000)
      await shot('npc-09-recovered.png')
      const wolfGone = await page.evaluate(() => window.__wolfStage)
      console.log('  lobo depois do apagão:', wolfGone)
      if (wolfGone !== 'hidden') fail(`lobo deveria estar oculto após o apagão, está: ${wolfGone}`)
    }
  }

  if (errors.length) {
    fail('erros de página durante a sessão:\n' + errors.join('\n'))
  }
} finally {
  await browser.close()
  stopVite()
}

if (failed) process.exitCode = 1
console.log(failed ? 'VERIFICACAO FALHOU' : 'VERIFICACAO OK')
