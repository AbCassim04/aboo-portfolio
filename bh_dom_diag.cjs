'use strict'
const { chromium } = require('playwright')
const fs = require('fs')

const URL = 'http://localhost:5175/aboo-portfolio/?mode=blackhole'

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist',
           '--no-sandbox','--disable-setuid-sandbox'],
  })
  const page = await (await browser.newContext({ viewport:{ width:1280, height:720 } })).newPage()

  const logs = []
  page.on('console', msg => { const e=`[${msg.type()}] ${msg.text()}`; logs.push(e) })
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`))

  await page.goto(URL, { waitUntil:'networkidle', timeout:20000 })

  // Wait briefly for React to mount (not waiting for BH onReady — just DOM)
  await page.waitForTimeout(3000)

  // ── 1. Full body DOM structure ───────────────────────────────────────────────
  const bodyHTML = await page.evaluate(() => {
    function dump(node, depth=0) {
      const pad = '  '.repeat(depth)
      if (node.nodeType === Node.TEXT_NODE) return ''
      const el = node
      const tag = el.tagName?.toLowerCase() ?? '?'
      const id = el.id ? `#${el.id}` : ''
      const cls = el.className && typeof el.className === 'string'
        ? `.${el.className.trim().replace(/\s+/g,'.')}` : ''
      const st = el.style?.cssText ? ` style="${el.style.cssText}"` : ''
      const computed = el instanceof HTMLElement ? window.getComputedStyle(el) : null
      const display   = computed?.display   ?? ''
      const visibility= computed?.visibility?? ''
      const opacity   = computed?.opacity   ?? ''
      const zIndex    = computed?.zIndex    ?? ''
      const pos       = computed?.position  ?? ''
      const width     = computed?.width     ?? ''
      const height    = computed?.height    ?? ''
      const extra = ` [disp=${display} vis=${visibility} op=${opacity} z=${zIndex} pos=${pos} w=${width} h=${height}]`
      let out = `${pad}<${tag}${id}${cls}${st}>${extra}\n`
      for (const child of node.childNodes) out += dump(child, depth+1)
      return out
    }
    return dump(document.body)
  })

  console.log('\n════ DOM HIERARCHY ════')
  console.log(bodyHTML)

  // ── 2. All canvas elements ──────────────────────────────────────────────────
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    return canvases.map((c, i) => {
      const cs = window.getComputedStyle(c)
      const rect = c.getBoundingClientRect()
      const ctx2d = (() => { try { return c.getContext('2d') } catch(_) { return null } })()
      let centerPixel = null
      if (ctx2d) {
        try {
          const d = ctx2d.getImageData(c.width>>1, c.height>>1, 1, 1).data
          centerPixel = `r=${d[0]} g=${d[1]} b=${d[2]} a=${d[3]}`
        } catch(_) { centerPixel = 'getImageData blocked (WebGL)' }
      } else {
        centerPixel = 'no 2d context (WebGL canvas)'
      }
      // Try to detect which Three.js renderer owns this canvas
      const glCtx = c.getContext('webgl2') ?? c.getContext('webgl')
      const glInfo = glCtx ? `WebGL(${glCtx.getParameter(glCtx.RENDERER)})` : 'no WebGL'
      return {
        index: i,
        width: c.width,
        height: c.height,
        styleWidth: cs.width,
        styleHeight: cs.height,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        position: cs.position,
        top: cs.top,
        left: cs.left,
        inset: cs.inset,
        overflow: cs.overflow,
        pointerEvents: cs.pointerEvents,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        id: c.id,
        className: c.className,
        parentTag: c.parentElement?.tagName ?? '?',
        parentClass: c.parentElement?.className ?? '?',
        centerPixel,
        glInfo,
        styleAttr: c.getAttribute('style') ?? '',
      }
    })
  })

  console.log('\n════ CANVAS INVENTORY ════')
  canvasInfo.forEach((c, i) => {
    console.log(`\n── Canvas[${i}] ──`)
    console.log(`  id="${c.id}" class="${c.className}"`)
    console.log(`  parent: <${c.parentTag} class="${c.parentClass}">`)
    console.log(`  intrinsic: ${c.width}×${c.height}`)
    console.log(`  style size: ${c.styleWidth}×${c.styleHeight}`)
    console.log(`  display=${c.display} visibility=${c.visibility} opacity=${c.opacity}`)
    console.log(`  position=${c.position} top=${c.top} left=${c.left}`)
    console.log(`  z-index=${c.zIndex}`)
    console.log(`  bounding rect: x=${c.rect.x} y=${c.rect.y} w=${c.rect.w} h=${c.rect.h}`)
    console.log(`  style attr: "${c.styleAttr}"`)
    console.log(`  center pixel: ${c.centerPixel}`)
    console.log(`  WebGL info: ${c.glInfo}`)
  })

  // ── 3. Stacking order at viewport center ───────────────────────────────────
  const stackAtCenter = await page.evaluate(() => {
    const els = document.elementsFromPoint(640, 360)
    return els.map(el => {
      const cs = window.getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id,
        cls: typeof el.className === 'string' ? el.className : '',
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        position: cs.position,
        display: cs.display,
        bg: cs.backgroundColor,
      }
    })
  })

  console.log('\n════ ELEMENT STACK AT VIEWPORT CENTER (640,360) ════')
  stackAtCenter.forEach((el, i) => {
    console.log(`  [${i}] <${el.tag}#${el.id}.${el.cls.replace(/\s+/g,'.')}> op=${el.opacity} z=${el.zIndex} pos=${el.position} bg=${el.bg}`)
  })

  // ── 4. React root / mode state ─────────────────────────────────────────────
  const reactState = await page.evaluate(() => {
    // Find all elements with React fiber data
    const results = []
    function findReactInst(el) {
      for (const key of Object.keys(el)) {
        if (key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')) {
          return el[key]
        }
      }
      return null
    }
    // Check the root div and its children
    const root = document.getElementById('root') ?? document.querySelector('[data-reactroot]') ?? document.body.firstElementChild
    if (root) {
      results.push(`root element: <${root.tagName} id="${root.id}" class="${root.className}">`)
      // Check children
      for (const child of root.children) {
        results.push(`  child: <${child.tagName} id="${child.id}" class="${child.className}" style="${child.getAttribute('style') ?? ''}">`)
        for (const gc of child.children) {
          results.push(`    grandchild: <${gc.tagName} id="${gc.id}" class="${gc.className}" style="${gc.getAttribute('style') ?? ''}">`)
        }
      }
    }
    // Check for any "blackhole" or "bh" text in class/id
    const bhEls = document.querySelectorAll('[class*="black"],[class*="hole"],[class*="bh"],[id*="black"],[id*="hole"],[id*="bh"]')
    bhEls.forEach(el => results.push(`BH-related: <${el.tagName} id="${el.id}" class="${el.className}">`))
    return results
  })

  console.log('\n════ REACT ROOT STRUCTURE ════')
  reactState.forEach(l => console.log(l))

  // ── 5. Check for Three.js / R3F related DOM ─────────────────────────────────
  const r3fCheck = await page.evaluate(() => {
    // R3F adds data-engine attribute to its canvas
    const r3fCanvas = document.querySelector('canvas[data-engine]')
    // Check all canvases for R3F markers
    const canvases = Array.from(document.querySelectorAll('canvas'))
    return {
      r3fCanvas: r3fCanvas ? {
        dataEngine: r3fCanvas.getAttribute('data-engine'),
        style: r3fCanvas.getAttribute('style'),
        parent: r3fCanvas.parentElement?.className ?? '?',
      } : null,
      canvasCount: canvases.length,
      canvasDataAttrs: canvases.map(c => ({
        attrs: Array.from(c.attributes).map(a => `${a.name}="${a.value}"`).join(' '),
      })),
    }
  })

  console.log('\n════ R3F / THREE.JS CANVAS MARKERS ════')
  console.log(JSON.stringify(r3fCheck, null, 2))

  // ── 6. Screenshot ───────────────────────────────────────────────────────────
  const shot = '/tmp/bh_dom_diag.png'
  await page.screenshot({ path: shot, fullPage: false, timeout: 15000 })
  const sz = fs.existsSync(shot) ? fs.statSync(shot).size : 0
  console.log(`\n════ Screenshot: ${shot} (${sz} bytes) ════`)

  // ── 7. Relevant console logs ─────────────────────────────────────────────────
  const relevant = logs.filter(l =>
    l.includes('[BH') || l.includes('pageerror') || l.includes('WebGL') ||
    l.includes('Error') || l.includes('warn') || l.includes('three') ||
    l.includes('react') || l.includes('mount') || l.includes('canvas')
  )
  console.log('\n════ RELEVANT CONSOLE LOGS ════')
  relevant.forEach(l => console.log(l))

  await browser.close()
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
