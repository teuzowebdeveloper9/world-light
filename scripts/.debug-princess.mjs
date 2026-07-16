// Teste focado: só a princesa — sem apertar NENHUMA tecla de movimento,
// imprime introT/timer/fleeing/dist/paused nos primeiros ~90s.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = 5237
const BASE = `http://localhost:${PORT}`
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
})
const stopVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM')
  } catch {}
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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(`${BASE}/?sageAt=99999&wolfAt=99999`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('KeyK')
  await page.waitForSelector('.help-panel', { timeout: 90000 })
  console.log('--- fase playing ---')

  const t0 = Date.now()
  let prev = ''
  while (Date.now() - t0 < 90000) {
    const s = await page.evaluate(() => {
      const d = window.__princessDbg
      const st = window.__store?.getState?.()
      return {
        introT: window.__cameraRig?.introT?.toFixed?.(2),
        timer: d?.timer?.toFixed?.(2),
        fleeing: d?.fleeing,
        dist: d?.dist?.toFixed?.(1),
        paused: st?.paused,
        phase: st?.phase,
        gone: window.__princessGone === true,
      }
    })
    const line = JSON.stringify(s)
    if (line !== prev) {
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`)
      prev = line
    }
    if (s.gone) break
    await page.waitForTimeout(1000)
  }
} finally {
  await browser.close()
  stopVite()
}
