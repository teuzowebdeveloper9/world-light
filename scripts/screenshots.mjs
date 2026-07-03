/**
 * Gera os prints do README em docs/screenshots/ usando Playwright
 * (Chrome do sistema, headless, WebGL via SwiftShader).
 *
 * Uso: npm run screenshots
 * Sobe o vite sozinho na porta 5199, joga uma sessão curta e salva os PNGs.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = 5199
const BASE = `http://localhost:${PORT}`
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname

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

// Espera o dev server responder.
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

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // O bioma de nascimento é sorteado por sessão — recarrega até cair no
  // campo (0 = temperate), o visual clássico do jogo para os prints.
  for (let i = 0; i < 10; i++) {
    const biome = await page.evaluate(() => window.__spawnBiome)
    if (biome === 0 || biome === undefined) break
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
  }

  await page.screenshot({ path: OUT + '01-title.png' })
  console.log('✓ 01-title.png')

  // Qualquer tecla entra no mundo. A HUD (.help-panel) só monta quando a
  // fase vira "playing"; depois disso a intro cinematográfica leva ~6s.
  await page.keyboard.press('KeyK')
  await page.waitForSelector('.help-panel', { timeout: 90000 })
  // A intro dura ~6s de tempo de JOGO, mas com FPS baixo (SwiftShader) o dt
  // é clampado em 0.05s e ela estica no relógio — espera com folga.
  await page.waitForTimeout(30000)

  // Nivela a câmera (arrastar para baixo abaixa o pitch) para enquadrar o
  // horizonte em vez do chão.
  await page.mouse.move(800, 380)
  await page.mouse.down()
  await page.mouse.move(800, 500, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: OUT + '02-world.png' })
  console.log('✓ 02-world.png')

  // Corre pelo mundo e gira a câmera para um ângulo mais dramático.
  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(6000)
  await page.mouse.move(800, 450)
  await page.mouse.down()
  await page.mouse.move(950, 440, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + '03-running.png' })
  console.log('✓ 03-running.png')

  // Pulo + planagem (segurando Espaço na queda).
  await page.keyboard.down('Space')
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + '04-glide.png' })
  console.log('✓ 04-glide.png')
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')

  if (errors.length) {
    console.error('Erros de página durante a sessão:\n' + errors.join('\n'))
    process.exitCode = 1
  }
} finally {
  await browser.close()
  stopVite()
}
