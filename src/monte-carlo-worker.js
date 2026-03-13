// Monte Carlo Web Worker for CDC Pension Simulator
// Runs N stochastic simulations with correlated parameter shocks

import { runSimulation } from './simulation-engine.js'

// Box-Muller transform for standard normal
function randn() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Generate correlated normal samples via Cholesky decomposition
// Variables: [r_c, r_d_base, pi, w_r]
// Correlation matrix:
//   r_c    r_d    pi     w_r
//   1.0   -0.1   -0.2    0.3    r_c
//  -0.1    1.0    0.6    0.0    r_d
//  -0.2    0.6    1.0    0.1    pi
//   0.3    0.0    0.1    1.0    w_r

const CORR = [
  [1.0,  -0.1, -0.2, 0.3],
  [-0.1,  1.0,  0.6, 0.0],
  [-0.2,  0.6,  1.0, 0.1],
  [0.3,   0.0,  0.1, 1.0],
]

// Cholesky decomposition of CORR (lower triangular)
function cholesky(M) {
  const n = M.length
  const L = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k]
      if (i === j) {
        L[i][j] = Math.sqrt(M[i][i] - sum)
      } else {
        L[i][j] = (M[i][j] - sum) / L[j][j]
      }
    }
  }
  return L
}

const L = cholesky(CORR)

// Standard deviations for annual shocks
const SIGMAS = [0.02, 0.01, 0.015, 0.005]  // r_c, r_d, pi, w_r

function generateCorrelatedShocks() {
  const z = [randn(), randn(), randn(), randn()]
  const shocks = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j <= i; j++) {
      shocks[i] += L[i][j] * z[j]
    }
    shocks[i] *= SIGMAS[i]
  }
  return shocks
}

self.onmessage = function(e) {
  const { params, runs } = e.data
  const N = params.N

  // Storage for percentile computation
  const debtPaths = Array.from({ length: N }, () => [])
  const capiPaths = Array.from({ length: N }, () => [])
  const capiRealPaths = Array.from({ length: N }, () => [])
  const spreadPaths = Array.from({ length: N }, () => [])

  for (let run = 0; run < runs; run++) {
    // For each run, apply year-level shocks
    // We run the simulation with perturbed parameters
    // Simplified: draw ONE set of shocks per run (persistent regime shift)
    const shocks = generateCorrelatedShocks()

    const perturbedParams = {
      ...params,
      r_c: Math.max(0.005, params.r_c + shocks[0]),
      r_d_base: Math.max(0.01, params.r_d_base + shocks[1]),
      pi: Math.max(0.001, params.pi + shocks[2]),
      w_r: Math.max(-0.01, params.w_r + shocks[3]),
    }

    const results = runSimulation(perturbedParams)

    for (let t = 0; t < N; t++) {
      debtPaths[t].push(results[t].debt)
      capiPaths[t].push(results[t].capi)
      capiRealPaths[t].push(results[t].capiReal)
      spreadPaths[t].push(results[t].spread)
    }

    // Report progress every 100 runs
    if ((run + 1) % 100 === 0) {
      self.postMessage({ type: 'progress', completed: run + 1, total: runs })
    }
  }

  // Compute percentiles
  function percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b)
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
  }

  const bands = []
  for (let t = 0; t < N; t++) {
    bands.push({
      year: 2026 + t,
      debt_p5: percentile(debtPaths[t], 5),
      debt_p25: percentile(debtPaths[t], 25),
      debt_p50: percentile(debtPaths[t], 50),
      debt_p75: percentile(debtPaths[t], 75),
      debt_p95: percentile(debtPaths[t], 95),
      capi_p5: percentile(capiPaths[t], 5),
      capi_p25: percentile(capiPaths[t], 25),
      capi_p50: percentile(capiPaths[t], 50),
      capi_p75: percentile(capiPaths[t], 75),
      capi_p95: percentile(capiPaths[t], 95),
      capiReal_p5: percentile(capiRealPaths[t], 5),
      capiReal_p25: percentile(capiRealPaths[t], 25),
      capiReal_p50: percentile(capiRealPaths[t], 50),
      capiReal_p75: percentile(capiRealPaths[t], 75),
      capiReal_p95: percentile(capiRealPaths[t], 95),
      spread_p5: percentile(spreadPaths[t], 5),
      spread_p50: percentile(spreadPaths[t], 50),
      spread_p95: percentile(spreadPaths[t], 95),
    })
  }

  self.postMessage({ type: 'result', bands })
}
