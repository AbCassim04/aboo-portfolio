// Master grid: equirectangular, 2:1, row 0 at 90°N, column 0 at 180°W, pixel
// centres at half-steps — the same layout as the Earth textures and three.js
// sphere UVs (see src/earth/geo.ts).

export const W = 4096
export const H = 2048
export const N = W * H

const DEG = Math.PI / 180

export const latOfRow = (y, h = H) => 90 - (y + 0.5) * 180 / h
export const lonOfCol = (x, w = W) => -180 + (x + 0.5) * 360 / w

/** cos(latitude) per row — area weight of a pixel. */
export const ROW_WEIGHT = Float32Array.from({ length: H }, (_, y) => Math.cos(latOfRow(y) * DEG))

export const smoothstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Great-circle angle (deg) between (lat, lon) and a point on the equator. */
export function angleFromSubpoint(latDeg, lonDeg, subLonDeg) {
  const c = Math.cos(latDeg * DEG) * Math.cos((lonDeg - subLonDeg) * DEG)
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG
}

/** Area-weighted mean of `weight` over the globe (0..1 for weights in 0..1). */
export function globalFraction(weight) {
  let s = 0, a = 0
  for (let y = 0; y < H; y++) {
    const rw = ROW_WEIGHT[y]
    const o = y * W
    for (let x = 0; x < W; x++) s += weight[o + x] * rw
    a += rw * W
  }
  return s / a
}

/**
 * Separable box blur on a coarse float grid that wraps in longitude and
 * clamps in latitude. NaNs are ignored (normalised by valid count).
 */
export function blurWrap(src, w, h, radius, passes = 1) {
  let a = Float32Array.from(src)
  let b = new Float32Array(a.length)
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const v = a[y * w + ((x + k + w) % w)]
          if (!Number.isNaN(v)) { s += v; n++ }
        }
        b[y * w + x] = n ? s / n : NaN
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.max(0, Math.min(h - 1, y + k))
          const v = b[yy * w + x]
          if (!Number.isNaN(v)) { s += v; n++ }
        }
        a[y * w + x] = n ? s / n : NaN
      }
    }
  }
  return a
}

/** Bilinear sample of a coarse grid (cell centres) at master pixel (x, y). */
export function sampleCoarse(grid, cw, ch, x, y) {
  const gx = (x + 0.5) * cw / W - 0.5
  const gy = Math.max(0, Math.min(ch - 1, (y + 0.5) * ch / H - 0.5))
  const x0 = Math.floor(gx), y0 = Math.min(ch - 2, Math.floor(gy))
  const fx = gx - x0, fy = gy - y0
  const xa = (x0 + cw) % cw, xb = (x0 + 1) % cw
  const v00 = grid[y0 * cw + xa], v10 = grid[y0 * cw + xb]
  const v01 = grid[(y0 + 1) * cw + xa], v11 = grid[(y0 + 1) * cw + xb]
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
}

/**
 * Conditional 3×3 median ("despeckle"): a pixel is replaced by the median of
 * its valid neighbourhood only if it differs from it by more than `tol`.
 * Removes impulse noise (isolated pixels) while leaving real edges intact.
 */
export function despeckle(src, w, h, tol) {
  const out = Float32Array.from(src)
  const nb = new Float32Array(9)
  let replaced = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]
      if (Number.isNaN(v)) continue
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const q = src[yy * w + ((x + dx + w) % w)]
          if (!Number.isNaN(q)) nb[n++] = q
        }
      }
      if (n < 5) continue
      // insertion sort of ≤ 9 values
      for (let i = 1; i < n; i++) { const t = nb[i]; let j = i - 1; while (j >= 0 && nb[j] > t) { nb[j + 1] = nb[j]; j-- } nb[j + 1] = t }
      const m = n & 1 ? nb[n >> 1] : 0.5 * (nb[(n >> 1) - 1] + nb[n >> 1])
      if (Math.abs(v - m) > tol) { out[y * w + x] = m; replaced++ }
    }
  }
  return { out, replaced }
}

/** Fill NaN holes from progressively coarser averages (push–pull). */
export function pushPullFill(src, w, h) {
  const levels = [{ v: Float32Array.from(src), w, h }]
  for (;;) {
    const L = levels[levels.length - 1]
    if (L.w <= 2 || L.h <= 2) break
    const nw = Math.ceil(L.w / 2), nh = Math.ceil(L.h / 2)
    const v = new Float32Array(nw * nh).fill(NaN)
    let holes = 0
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let s = 0, c = 0
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const yy = 2 * y + dy, xx = 2 * x + dx
          if (yy >= L.h || xx >= L.w) continue
          const q = L.v[yy * L.w + xx]
          if (!Number.isNaN(q)) { s += q; c++ }
        }
        if (c) v[y * nw + x] = s / c
        else holes++
      }
    }
    levels.push({ v, w: nw, h: nh })
    if (!holes) break
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], P = levels[l + 1]
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x
        if (Number.isNaN(L.v[i])) L.v[i] = P.v[(y >> 1) * P.w + (x >> 1)]
      }
    }
  }
  return levels[0].v
}
