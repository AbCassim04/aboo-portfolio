'use strict'
// Tests the NORMAL flow: Hub → click "Take Flight" button → count canvases
// Then navigates directly to ?mode=blackhole for BH-only canvas count
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = 'http://localhost:5175/aboo-portfolio/'

async function countCanvases(page, label) {
  const info = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    return canvases.map((c, i) => {
      const cs = window.getComputedStyle(c)
      return {
        i,
        w: c.width, h: c.height,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        position: cs.position,
        dataEngine: c.getAttribute('data-engine') ?? 'none',
        styleAttr: c.getAttribute('style') ?? '',
        parentTag: c.parentElement?.tagName ?? '?',
        parentStyle: c.parentElement?.getAttribute('style') ?? '',
        rect: (() => { const r = c.getBoundingClientRect(); return `${r.x},${r.y} ${r.width}×${r.height}` })(),
      }
    })
  })
  console.log(`\n══ CANVAS COUNT @ ${label}: ${info.length} ══`)
  info.forEach(c => {
    console.log(`  [${c.i}] ${c.w}×${c.h}  data-engine="${c.dataEngine}"`)
    console.log(`       opacity=${c.opacity} z=${c.zIndex} pos=${c.position} display=${c.display}`)
    console.log(`       rect=${c.rect}`)
    console.log(`       parent: <${c.parentTag} style="${c.parentStyle.slice(0,80)}">`)
    console.log(`       style: "${c.styleAttr.slice(0,100)}"`)
  })
  return info
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
           '--no-sandbox','--disable-setuid-sandbox'],
  })
  const ctx = await browser.newContext({ viewport:{ width:1280, height:720 } })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))

  // ── Step 1: Hub mode ─────────────────────────────────────────────
  console.log('\n╔══ STEP 1: Hub mode (default URL) ══╗')
  await page.goto(BASE, { waitUntil:'networkidle', timeout:20000 })
  await page.waitForTimeout(2000)
  await countCanvases(page, 'HUB MODE')
  const shotHub = '/tmp/bh_flow_hub.png'
  await page.screenshot({ path: shotHub, timeout: 15000 }).catch(e => console.log('screenshot failed:', e.message))
  if (fs.existsSync(shotHub)) console.log(`  Screenshot: ${shotHub} (${fs.statSync(shotHub).size} bytes)`)

  // ── Step 2: Find + click Take Flight button ──────────────────────
  console.log('\n╔══ STEP 2: Clicking Take Flight ══╗')
  const flightBtn = await page.$('button:has-text("TAKE FLIGHT"), button:has-text("Take Flight"), [data-testid="take-flight"]')
  if (flightBtn) {
    console.log('  Found Take Flight button — clicking')
    await flightBtn.click()
    await page.waitForTimeout(3000)
    await countCanvases(page, 'FLIGHT MODE')
  } else {
    console.log('  Take Flight button not found — trying direct URL')
    // Fallback: force flight mode via JS
    await page.evaluate(() => {
      // Try to find and click any button with flight-related text
      const btns = Array.from(document.querySelectorAll('button'))
      const found = btns.find(b => b.textContent?.toUpperCase().includes('FLIGHT') || b.textContent?.toUpperCase().includes('LAUNCH'))
      if (found) found.click()
    })
    await page.waitForTimeout(3000)
    await countCanvases(page, 'AFTER FLIGHT ATTEMPT')
  }

  // What buttons exist in hub mode?
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => `"${b.textContent?.trim()}"`)
  )
  console.log('\n  Buttons in current state:', buttons.join(', '))

  // ── Step 3: Directly navigate to blackhole mode ──────────────────
  console.log('\n╔══ STEP 3: Direct ?mode=blackhole ══╗')
  await page.goto(BASE + '?mode=blackhole', { waitUntil:'networkidle', timeout:20000 })
  await page.waitForTimeout(3000)
  await countCanvases(page, 'BLACKHOLE MODE (direct URL)')
  const shotBH = '/tmp/bh_flow_bh.png'
  await page.screenshot({ path: shotBH, timeout: 15000 }).catch(e => console.log('screenshot failed:', e.message))
  if (fs.existsSync(shotBH)) console.log(`  Screenshot: ${shotBH} (${fs.statSync(shotBH).size} bytes)`)

  // ── DOM detail in blackhole mode ─────────────────────────────────
  const domDetail = await page.evaluate(() => {
    function dump(el, depth) {
      if (depth > 4) return ''
      const pad = '  '.repeat(depth)
      const tag = el.tagName?.toLowerCase()
      const cs = window.getComputedStyle(el)
      const attrs = Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(' ')
      return `${pad}<${tag} ${attrs}> [op=${cs.opacity} z=${cs.zIndex} pos=${cs.position}]\n` +
             Array.from(el.children).map(c => dump(c, depth+1)).join('')
    }
    return dump(document.body, 0)
  })
  console.log('\n══ DOM DETAIL (blackhole mode, depth≤4) ══')
  console.log(domDetail)

  // Relevant logs
  const rel = logs.filter(l => l.includes('[BH') || l.includes('pageerror') || l.includes('Error'))
  if (rel.length) {
    console.log('\n══ RELEVANT LOGS ══')
    rel.forEach(l => console.log(l))
  }

  await browser.close()
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
