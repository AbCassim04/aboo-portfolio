'use strict'
const { chromium } = require('playwright')
const fs = require('fs')

const URL = 'http://localhost:5175/aboo-portfolio/?mode=blackhole'
const SHOT = '/tmp/bh_stage_full.png'

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox','--disable-setuid-sandbox'],
  })
  // 800x200 = 160k pixels × 100 steps (desktop). SwiftShader is slow — give 5 min.
  const page = await (await browser.newContext({ viewport:{ width:800, height:200 } })).newPage()
  const logs = []
  page.on('console', msg => { const e=`[${msg.type()}] ${msg.text()}`; logs.push(e); process.stdout.write(e+'\n') })
  page.on('pageerror', err => { const e=`[pageerror] ${err.message}`; logs.push(e); process.stdout.write(e+'\n') })

  await page.goto(URL, { waitUntil:'networkidle', timeout:20000 })
  try {
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas')
      return c && parseFloat(getComputedStyle(c).opacity) > 0.9
    }, { timeout: 300000 })  // 5 minutes
    console.log('\n=== Canvas visible ===')
  } catch(_) { console.log('\n=== Canvas never became visible ===') }
  await page.waitForTimeout(2000)
  await page.screenshot({ path: SHOT, timeout: 30000 })

  const sz = fs.existsSync(SHOT) ? fs.statSync(SHOT).size : 0
  console.log(`\n=== Screenshot: ${SHOT} (${sz} bytes) ===`)
  const dbg = logs.filter(l => l.includes('[BH') || l.includes('WebGL'))
  if (dbg.length) { console.log('\n--- BH logs ---'); dbg.forEach(l => console.log(l)) }
  await browser.close()
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
