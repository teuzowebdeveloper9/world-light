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
   * update() e desprendendo de encostas (pulo + virada) se parar de render.
   * Depois de um destrave, SEGURA o desvio por alguns segundos antes de
   * voltar a mirar o alvo — senão a mira joga o player de volta no paredão
   * e ele fica quicando contra a mesma encosta para sempre.
   */
  async function walkUntil(doneCheck, update, timeoutMs) {
    await page.keyboard.down('KeyW')
    await page.keyboard.down('ShiftLeft')
    const t0 = Date.now()
    let last = await playerPos()
    let lastMove = Date.now()
    let detourUntil = 0
    let ok = false
    while (Date.now() - t0 < timeoutMs) {
      if (await doneCheck()) {
        ok = true
        break
      }
      if (update && Date.now() > detourUntil) await update()
      await page.waitForTimeout(700)
      const p = await playerPos()
      if (Math.hypot(p.x - last.x, p.z - last.z) > 1.2) {
        last = p
        lastMove = Date.now()
      } else if (Date.now() - lastMove > 4500) {
        // Preso numa encosta: pula, vira um tanto e mantém o desvio.
        await page.keyboard.press('Space')
        await page.evaluate(() => {
          window.__cameraRig.yaw += 1.2
        })
        detourUntil = Date.now() + 5000
        lastMove = Date.now()
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

  // ---- Princesa: parada à frente na intro; foge para sempre. ----
  await page.waitForTimeout(2500)
  await shot('npc-01-princess-wait.png')
  const d1 = await page.evaluate(() => {
    const a = window.__princessPos
    const p = window.__playerState.position
    return a ? Math.hypot(a.x - p.x, a.z - p.z) : null
  })
  await page.waitForTimeout(9000)
  await shot('npc-02-princess-flee.png')
  const d2 = await page.evaluate(() => {
    const a = window.__princessPos
    const p = window.__playerState.position
    return a ? Math.hypot(a.x - p.x, a.z - p.z) : null
  })
  if (d1 === null) fail('princesa nunca montou (__princessPos ausente)')
  else console.log(`  princesa: ${d1.toFixed(1)}m -> ${d2?.toFixed(1)}m`)

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
      return Math.hypot(s.x - p.x, s.z - p.z) < 4.6
    })
  const steerToSage = () =>
    page.evaluate(() => {
      const s = window.__sagePos
      if (!s) return
      const p = window.__playerState.position
      window.__cameraRig.yaw = Math.atan2(-(s.x - p.x), -(s.z - p.z))
    })
  if (!(await walkUntil(sageNear, steerToSage, 420000))) {
    fail('não conseguiu chegar a 4.6m do sábio')
  } else {
    const prompt = await page.waitForSelector('.npc-prompt', { timeout: 8000 }).catch(() => null)
    if (!prompt) {
      fail('prompt "falar com o Sábio" não apareceu perto dele')
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
  if (!(await walkUntil(async () => (await walkTime()) >= 40, null, 420000))) {
    fail('walkTime nunca chegou a 40s (lobo)')
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
