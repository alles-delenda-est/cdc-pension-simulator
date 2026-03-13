import { useState, useMemo, useCallback, useRef } from 'react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart,
} from 'recharts'
import { runSimulation, extractKPIs, PRESETS, equinoxeReductionRate } from './simulation-engine.js'

// --- Slider component ---
function Slider({ label, value, onChange, min, max, step, unit, decimals = 1 }) {
  return (
    <div className="control">
      <div className="control-header">
        <label>{label}</label>
        <span className="control-value">{value.toFixed(decimals)} {unit}</span>
      </div>
      <input type="range" className="slider" min={min} max={max} step={step}
        value={value} onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="toggle-row">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <label>{label}</label>
    </div>
  )
}

// --- Format helpers ---
const fmtMd = v => `${v.toFixed(0)} Md`
const fmtTn = v => `${(v / 1000).toFixed(2)} Tn`
const fmtPct = v => `${(v * 100).toFixed(2)}%`
const fmtYear = v => v ? `${v}` : 'Jamais'

// --- URL parameter encoding/decoding ---
function paramsToURL(params) {
  const defs = PRESETS.default.params
  const diff = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== defs[k]) diff[k] = v
  }
  if (Object.keys(diff).length === 0) return ''
  return '?' + new URLSearchParams(diff).toString()
}

function paramsFromURL() {
  const sp = new URLSearchParams(window.location.search)
  if (sp.size === 0) return null

  // Check for preset
  const preset = sp.get('preset')
  if (preset && PRESETS[preset]) {
    const base = { ...PRESETS[preset].params }
    sp.delete('preset')
    for (const [k, v] of sp.entries()) {
      if (k in base) {
        base[k] = v === 'true' ? true : v === 'false' ? false : parseFloat(v)
      }
    }
    return base
  }

  // Otherwise overlay on defaults
  const base = { ...PRESETS.default.params }
  for (const [k, v] of sp.entries()) {
    if (k in base) {
      base[k] = v === 'true' ? true : v === 'false' ? false : parseFloat(v)
    }
  }
  return base
}

// --- Main App ---
export default function App() {
  const initialParams = paramsFromURL() || PRESETS.default.params
  const [params, setParams] = useState(initialParams)
  const [activePreset, setActivePreset] = useState(paramsFromURL() ? null : 'default')
  const [showParams, setShowParams] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [mcBands, setMcBands] = useState(null)
  const [mcRuns, setMcRuns] = useState(1000)
  const [mcRunning, setMcRunning] = useState(false)
  const [mcProgress, setMcProgress] = useState('')
  const workerRef = useRef(null)

  const setParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }))
    setActivePreset(null)
    setMcBands(null)
  }, [])

  const applyPreset = useCallback((key) => {
    setParams({ ...PRESETS[key].params })
    setActivePreset(key)
    setMcBands(null)
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // Run deterministic simulation
  const { results, kpis } = useMemo(() => {
    const results = runSimulation(params)
    const kpis = extractKPIs(results)
    return { results, kpis }
  }, [params])

  // Update URL
  useMemo(() => {
    const url = paramsToURL(params)
    if (url) {
      window.history.replaceState(null, '', url)
    } else {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [params])

  // Monte Carlo
  const runMC = useCallback(() => {
    setMcRunning(true)
    setMcProgress('Initialisation...')
    setMcBands(null)

    if (workerRef.current) workerRef.current.terminate()
    const worker = new Worker(new URL('./monte-carlo-worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        setMcProgress(`${e.data.completed} / ${e.data.total}`)
      } else if (e.data.type === 'result') {
        setMcBands(e.data.bands)
        setMcRunning(false)
        setMcProgress('')
        worker.terminate()
      }
    }
    worker.postMessage({ params, runs: mcRuns })
  }, [params, mcRuns])

  // CSV export
  const exportCSV = useCallback(() => {
    const headers = ['Année', 'Dépenses legacy (Md€)', 'Revenus fonds (Md€)', 'HLM (Md€)',
      'Abattement (Md€)', 'Cotis. sal. → capi (Md€)', 'Cotis. empl. → legacy (Md€)', 'Cotis. empl. → capi (Md€)',
      'Intérêts dette (Md€)', 'Flux net (Md€)', 'Emprunt (Md€)', 'Remboursé (Md€)',
      'Prélèvement (Md€)', 'Dette (Md€)', 'Pot capi nominal (Md€)',
      'Pot capi réel (Md€)', 'r_d (%)', 'Spread (%)']
    const rows = results.map(r => [
      r.year, r.legacyExp.toFixed(1), r.fundReturn.toFixed(1), r.hlmProceeds.toFixed(1),
      r.abatement.toFixed(1), r.emplC_s.toFixed(1), r.emplrToLeg.toFixed(1), r.emplrToCap.toFixed(1),
      r.debtInterest.toFixed(1), r.netFlow.toFixed(1), r.borrowed.toFixed(1),
      r.repaid.toFixed(1), r.levy.toFixed(1), r.debt.toFixed(1),
      r.capi.toFixed(0), r.capiReal.toFixed(0), (r.r_d * 100).toFixed(2),
      (r.spread * 100).toFixed(2)
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cdc_simulation.csv'; a.click()
    URL.revokeObjectURL(url)
  }, [results])

  // Prepare chart data
  const chartData = useMemo(() => {
    return results.map((r, i) => {
      const mc = mcBands?.[i] || {}
      return {
        year: r.year,
        // Fund balance chart
        legacyExp: r.legacyExp,
        fundReturn: r.fundReturn,
        hlmProceeds: r.hlmProceeds,
        abatement: r.abatement,
        emplrToLeg: r.emplrToLeg,
        totalIncome: r.fundReturn + r.hlmProceeds + r.abatement + r.emplrToLeg,
        // Debt chart
        debt: r.debt,
        r_d: r.r_d * 100,
        debtRatio: r.debtRatio,
        // Capitalisation
        capi: r.capi / 1000,        // Tn€
        capiReal: r.capiReal / 1000, // Tn€
        // Spread
        spread: r.spread * 100,
        // Contributions
        emplC_s: r.emplC_s,
        emplrToLeg_bar: r.emplrToLeg,
        emplrToCap_bar: r.emplrToCap,
        levy: r.levy,
        // MC bands (in Tn€ for capi, Md€ for debt)
        capi_p5_p95: mc.capi_p5 !== undefined ? [mc.capi_p5 / 1000, mc.capi_p95 / 1000] : undefined,
        capi_p25_p75: mc.capi_p25 !== undefined ? [mc.capi_p25 / 1000, mc.capi_p75 / 1000] : undefined,
        capi_p50: mc.capi_p50 !== undefined ? mc.capi_p50 / 1000 : undefined,
        capiReal_p5_p95: mc.capiReal_p5 !== undefined ? [mc.capiReal_p5 / 1000, mc.capiReal_p95 / 1000] : undefined,
        capiReal_p25_p75: mc.capiReal_p25 !== undefined ? [mc.capiReal_p25 / 1000, mc.capiReal_p75 / 1000] : undefined,
        debt_p5_p95: mc.debt_p5 !== undefined ? [mc.debt_p5, mc.debt_p95] : undefined,
        debt_p25_p75: mc.debt_p25 !== undefined ? [mc.debt_p25, mc.debt_p75] : undefined,
        debt_p50: mc.debt_p50,
        // Pension split
        capiPayout: r.capiPayout,
        totalPensionExp: r.totalPensionExp,
        // NPV series (cumulative, in Tn€)
        pvLegacyCum: r.pvLegacyCum / 1000,
        pvCapiPayoutCum: r.pvCapiPayoutCum / 1000,
        debtNominal: r.debt / 1000, // Tn€ for NPV chart
        capiAsset: r.capi / 1000,   // Tn€
        netNPV: (r.pvCapiPayoutCum - r.pvLegacyCum) / 1000,
      }
    })
  }, [results, mcBands])

  const p = params  // shorthand

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <h1>Simulateur CDC — Transition Retraites PAYG → Capitalisation</h1>
        <p className="subtitle">Modèle post-critique avec corrections structurelles</p>
        <p className="version">v1.0 — 34 équations, Monte Carlo, taux endogènes</p>
      </header>

      {/* SECTION 1: PRESETS + PARAMS */}
      <section className="section preset-section">
        <h2>Scénarios</h2>
        <div className="preset-grid">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button key={key} className={`preset-btn ${activePreset === key ? 'active' : ''}`}
              onClick={() => applyPreset(key)}>
              <strong>{preset.label}</strong>
              <span className="desc">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="collapsible-header" onClick={() => setShowParams(!showParams)}>
          <span className={`arrow ${showParams ? 'open' : ''}`}>▶</span>
          <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Paramètres</h2>
        </div>
        {showParams && (
          <div className="controls-row" style={{ marginTop: '1rem' }}>
            {/* Macro */}
            <div className="control-group">
              <h3>Macro</h3>
              <Slider label="Inflation π" value={p.pi} onChange={v => setParam('pi', v)}
                min={0} max={0.06} step={0.001} unit="" decimals={3} />
              <Slider label="Croissance salariale réelle w_r" value={p.w_r}
                onChange={v => setParam('w_r', v)} min={0} max={0.03} step={0.001} unit="" decimals={3} />
              <Slider label="Horizon N (ans)" value={p.N} onChange={v => setParam('N', v)}
                min={20} max={80} step={1} unit="ans" decimals={0} />
              <Slider label="Dépenses initiales E₀ (Md€)" value={p.E0}
                onChange={v => setParam('E0', v)} min={280} max={400} step={5} unit="Md€" decimals={0} />
            </div>

            {/* Rendements */}
            <div className="control-group">
              <h3>Rendements</h3>
              <Slider label="Rendement capitalisation r_c (réel)" value={p.r_c}
                onChange={v => setParam('r_c', v)} min={0.01} max={0.07} step={0.005} unit="" decimals={3} />
              <Slider label="Rendement fonds legacy r_f (réel)" value={p.r_f}
                onChange={v => setParam('r_f', v)} min={0.01} max={0.06} step={0.005} unit="" decimals={3} />
            </div>

            {/* Emprunt */}
            <div className="control-group">
              <h3>Emprunt souverain</h3>
              <Slider label="Taux de base r_d" value={p.r_d_base}
                onChange={v => setParam('r_d_base', v)} min={0.01} max={0.07} step={0.001} unit="" decimals={3} />
              <Toggle label="Taux endogène (prime de risque)" checked={p.endogenousRd}
                onChange={v => setParam('endogenousRd', v)} />
              <Slider label="Spread additionnel" value={p.extraSpread}
                onChange={v => setParam('extraSpread', v)} min={0} max={0.02} step={0.001} unit="" decimals={3} />
              <Slider label="Seuil 1 — pas de prime (% PIB)" value={p.rpThreshold1}
                onChange={v => setParam('rpThreshold1', v)} min={100} max={250} step={10} unit="%" decimals={0} />
              <Slider label="Pente 1 (bps/pp)" value={p.rpSlope1 * 10000}
                onChange={v => setParam('rpSlope1', v / 10000)} min={0} max={10} step={0.5} unit="bps" decimals={1} />
              <Slider label="Seuil 3 — crise (% PIB)" value={p.rpThreshold3}
                onChange={v => setParam('rpThreshold3', v)} min={200} max={500} step={10} unit="%" decimals={0} />
              <Slider label="Pente 3 (bps/pp)" value={p.rpSlope3 * 10000}
                onChange={v => setParam('rpSlope3', v / 10000)} min={5} max={30} step={1} unit="bps" decimals={0} />
            </div>

            {/* HLM */}
            <div className="control-group">
              <h3>HLM</h3>
              <Slider label="Taux de liquidation ρ" value={p.rho}
                onChange={v => setParam('rho', v)} min={0.01} max={0.15} step={0.01} unit="" decimals={2} />
              <Toggle label="Décote volume HLM" checked={p.hlmDiscount}
                onChange={v => setParam('hlmDiscount', v)} />
              <Slider label="Élasticité prix δ" value={p.delta}
                onChange={v => setParam('delta', v)} min={0} max={0.5} step={0.05} unit="" decimals={2} />
              <Slider label="Prix marché P₀ (k€)" value={p.P0}
                onChange={v => setParam('P0', v)} min={100} max={250} step={5} unit="k€" decimals={0} />
              <Slider label="Croissance prix g_h (réel)" value={p.g_h}
                onChange={v => setParam('g_h', v)} min={0} max={0.03} step={0.005} unit="" decimals={3} />
            </div>

            {/* Cotisations */}
            <div className="control-group">
              <h3>Cotisations</h3>
              <Slider label="Taux salarié τˢ" value={p.tauS}
                onChange={v => setParam('tauS', v)} min={0.05} max={0.20} step={0.005} unit="" decimals={3} />
              <Slider label="Taux employeur τᵉ" value={p.tauE}
                onChange={v => setParam('tauE', v)} min={0.05} max={0.25} step={0.005} unit="" decimals={3} />
              <Slider label="Floor employeur φ_f" value={p.phiF}
                onChange={v => setParam('phiF', v)} min={0} max={0.5} step={0.05} unit="" decimals={2} />
            </div>

            {/* Transition levy */}
            <div className="control-group">
              <h3>Prélèvement transition</h3>
              <Slider label="Taux prélèvement λ" value={p.lambda}
                onChange={v => setParam('lambda', v)} min={0} max={0.50} step={0.05} unit="" decimals={2} />
              <Slider label="Activation T_λ (année)" value={p.Tlambda}
                onChange={v => setParam('Tlambda', v)} min={0} max={30} step={1} unit="" decimals={0} />
            </div>

            {/* Pension reductions */}
            <div className="control-group">
              <h3>Réductions pensions</h3>
              <Toggle label="Courbe Equinoxe (vs. step function)"
                checked={p.useEquinoxe} onChange={v => setParam('useEquinoxe', v)} />
              {!p.useEquinoxe && (
                <>
                  <Slider label="Taux réduction κ" value={p.kappa}
                    onChange={v => setParam('kappa', v)} min={0} max={0.25} step={0.01} unit="" decimals={2} />
                  <Slider label="Seuil (€/mois)" value={p.threshold}
                    onChange={v => setParam('threshold', v)} min={1500} max={3000} step={50} unit="€" decimals={0} />
                </>
              )}
            </div>

            {/* CDC */}
            <div className="control-group">
              <h3>CDC / Fonds</h3>
              <Slider label="Actifs CDC F₀ (Md€)" value={p.F0}
                onChange={v => setParam('F0', v)} min={100} max={300} step={10} unit="Md€" decimals={0} />
              <Slider label="Pic cohorte T_pk (ans)" value={p.Tpk}
                onChange={v => setParam('Tpk', v)} min={3} max={15} step={1} unit="" decimals={0} />
              <Slider label="Demi-vie cohorte T_hl (ans)" value={p.Thl}
                onChange={v => setParam('Thl', v)} min={15} max={40} step={1} unit="" decimals={0} />
            </div>
          </div>
        )}

        {/* Monte Carlo controls */}
        <div className="mc-controls">
          <button className="mc-btn" onClick={runMC} disabled={mcRunning}>
            {mcRunning ? 'Simulation en cours...' : 'Lancer Monte Carlo'}
          </button>
          <select className="mc-select" value={mcRuns} onChange={e => setMcRuns(parseInt(e.target.value))}>
            <option value={100}>100 runs</option>
            <option value={500}>500 runs</option>
            <option value={1000}>1 000 runs</option>
          </select>
          {mcProgress && <span className="mc-progress">{mcProgress}</span>}
          {mcBands && <span className="mc-progress" style={{ color: 'var(--color-success)' }}>Monte Carlo: bandes affichées</span>}
        </div>
      </section>

      {/* SECTION 2: KPIs */}
      <section className="section">
        <h2>Indicateurs clés</h2>
        <div className="kpi-grid">
          <div className="kpi-card">
            <h3>Dette pic</h3>
            <div className={`kpi-value ${kpis.peakDebt > 2000 ? 'kpi-bad' : kpis.peakDebt > 1500 ? 'kpi-warn' : 'kpi-ok'}`}>
              {fmtTn(kpis.peakDebt)} €
            </div>
            <div className="kpi-sub">Année {kpis.peakDebtYear}</div>
          </div>
          <div className="kpi-card">
            <h3>Année sans dette</h3>
            <div className={`kpi-value ${!kpis.debtFreeYear ? 'kpi-bad' : kpis.debtFreeYear > 2070 ? 'kpi-warn' : 'kpi-ok'}`}>
              {fmtYear(kpis.debtFreeYear)}
            </div>
          </div>
          <div className="kpi-card">
            <h3>Intérêts cumulés</h3>
            <div className="kpi-value">{fmtTn(kpis.totalInterest)} €</div>
          </div>
          <div className="kpi-card">
            <h3>Pot capitalisation (nominal)</h3>
            <div className="kpi-value">{fmtTn(kpis.finalCapi)} €</div>
          </div>
          <div className="kpi-card">
            <h3>Pot capitalisation (réel 2026€)</h3>
            <div className="kpi-value">{fmtTn(kpis.finalCapiReal)} €</div>
          </div>
          <div className="kpi-card">
            <h3>Spread σ min</h3>
            <div className={`kpi-value ${kpis.minSpread <= 0 ? 'kpi-bad' : kpis.minSpread < 0.01 ? 'kpi-warn' : 'kpi-ok'}`}>
              {fmtPct(kpis.minSpread)}
            </div>
          </div>
          <div className="kpi-card">
            <h3>Économies pension S₀</h3>
            <div className="kpi-value">{kpis.S0.toFixed(1)} Md€/an</div>
            <div className="kpi-sub">{p.useEquinoxe ? 'Equinoxe' : 'Step function'}</div>
          </div>
          <div className="kpi-card">
            <h3>Position nette</h3>
            <div className={`kpi-value ${kpis.netPosition > 0 ? 'kpi-ok' : 'kpi-bad'}`}>
              {fmtTn(kpis.netPosition)} €
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: CHARTS */}
      <section className="section">
        <h2>Graphiques</h2>

        {/* Chart 1: Fund balance */}
        <div className="chart-container">
          <h3>Bilan du fonds legacy — Dépenses vs. Revenus (Md€)</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Aire empilée = revenus du fonds. Quand l'aire dépasse la ligne rouge, le fonds est excédentaire (remboursement dette).
          </p>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Md€', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => `${v.toFixed(1)} Md€`} />
              <Legend />
              <Area type="monotone" dataKey="fundReturn" stackId="income" fill="#60a5fa" stroke="#3b82f6" name="Rendement fonds" />
              <Area type="monotone" dataKey="hlmProceeds" stackId="income" fill="#34d399" stroke="#10b981" name="HLM" />
              <Area type="monotone" dataKey="abatement" stackId="income" fill="#fbbf24" stroke="#f59e0b" name="Abattement fiscal" />
              <Area type="monotone" dataKey="emplrToLeg" stackId="income" fill="#a78bfa" stroke="#8b5cf6" name="Cotis. employeur → legacy" />
              <Line type="monotone" dataKey="legacyExp" stroke="#ef4444" strokeWidth={3} name="Dépenses legacy" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 1b: Pension split — legacy vs capi-funded */}
        <div className="chart-container">
          <h3>Dépenses retraites — Legacy (PAYG) vs. Capitalisation (Md€)</h3>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Md€', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => `${typeof v === 'number' ? v.toFixed(1) : v} Md€`} />
              <Legend />
              <Area type="monotone" dataKey="legacyExp" stackId="pensions" fill="#fca5a5" stroke="#ef4444" name="Pensions legacy (PAYG)" />
              <Area type="monotone" dataKey="capiPayout" stackId="pensions" fill="#86efac" stroke="#059669" name="Pensions capitalisation" />
              <Line type="monotone" dataKey="totalPensionExp" stroke="#1e293b" strokeWidth={2} strokeDasharray="5 5" name="Total pensions" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: Sovereign debt trajectory */}
        <div className="chart-container">
          <h3>Trajectoire dette souveraine (Md€) + taux d'emprunt effectif</h3>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis yAxisId="left" label={{ value: 'Md€', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: 'r_d (%)', angle: 90, position: 'insideRight' }} />
              <Tooltip />
              <Legend />
              {mcBands && (
                <>
                  <Area yAxisId="left" type="monotone" dataKey="debt_p5_p95" fill="#fecaca" stroke="none" name="IC 90% dette" opacity={0.4} />
                  <Area yAxisId="left" type="monotone" dataKey="debt_p25_p75" fill="#fca5a5" stroke="none" name="IC 50% dette" opacity={0.4} />
                </>
              )}
              <Line yAxisId="left" type="monotone" dataKey="debt" stroke="#dc2626" strokeWidth={3} name="Dette (Md€)" dot={false} />
              {mcBands && (
                <Line yAxisId="left" type="monotone" dataKey="debt_p50" stroke="#dc2626" strokeWidth={1} strokeDasharray="4 4" name="Médiane MC" dot={false} />
              )}
              <Line yAxisId="right" type="monotone" dataKey="r_d" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name="r_d effectif (%)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 3: Capitalisation pot */}
        <div className="chart-container">
          <h3>Pot de capitalisation (Tn€)</h3>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Tn€', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => {
                if (Array.isArray(v)) return `[${v[0].toFixed(1)}, ${v[1].toFixed(1)}] Tn€`
                return `${typeof v === 'number' ? v.toFixed(2) : v} Tn€`
              }} />
              <Legend />
              {mcBands && (
                <>
                  <Area type="monotone" dataKey="capi_p5_p95" fill="#bbf7d0" stroke="none" name="IC 90% nominal" opacity={0.3} />
                  <Area type="monotone" dataKey="capi_p25_p75" fill="#86efac" stroke="none" name="IC 50% nominal" opacity={0.3} />
                  <Area type="monotone" dataKey="capiReal_p5_p95" fill="#bfdbfe" stroke="none" name="IC 90% réel" opacity={0.3} />
                  <Area type="monotone" dataKey="capiReal_p25_p75" fill="#93c5fd" stroke="none" name="IC 50% réel" opacity={0.3} />
                </>
              )}
              <Line type="monotone" dataKey="capi" stroke="#059669" strokeWidth={3} name="Nominal" dot={false} />
              <Line type="monotone" dataKey="capiReal" stroke="#2563eb" strokeWidth={3} name="Réel (€ 2026)" dot={false} />
              {mcBands && (
                <>
                  <Line type="monotone" dataKey="capi_p50" stroke="#059669" strokeWidth={1} strokeDasharray="4 4" name="Médiane MC nom." dot={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 4: Spread */}
        <div className="chart-container">
          <h3>Spread σ = r_f − (r_d − π) en points de %</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: '%', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
              <ReferenceLine y={0} stroke="#dc2626" strokeWidth={2} strokeDasharray="8 4" label={{ value: 'σ=0 (danger)', fill: '#dc2626', fontSize: 12 }} />
              <Line type="monotone" dataKey="spread" stroke="#7c3aed" strokeWidth={2} name="Spread σ (%)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 5: Contribution flows */}
        <div className="chart-container">
          <h3>Flux de cotisations (Md€/an)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData.filter((_, i) => i % 2 === 0)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Md€', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => `${v.toFixed(1)} Md€`} />
              <Legend />
              <Bar dataKey="emplC_s" stackId="a" fill="#3b82f6" name="Salarié → capi" />
              <Bar dataKey="emplrToCap_bar" stackId="a" fill="#8b5cf6" name="Employeur → capi" />
              <Bar dataKey="emplrToLeg_bar" stackId="a" fill="#f97316" name="Employeur → legacy" />
              <Bar dataKey="levy" stackId="b" fill="#ef4444" name="Prélèvement transition" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 6: NPV — Accrued liabilities vs capitalisation vs debt */}
        <div className="chart-container">
          <h3>VAN cumulée — Engagements legacy, paiements capitalisation, dette et actifs (Tn€, actualisés à r_d)</h3>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Tn€', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(v) => `${typeof v === 'number' ? v.toFixed(2) : v} Tn€`} />
              <Legend />
              <Line type="monotone" dataKey="pvLegacyCum" stroke="#ef4444" strokeWidth={3} name="VAN engagements legacy (cum.)" dot={false} />
              <Line type="monotone" dataKey="pvCapiPayoutCum" stroke="#059669" strokeWidth={3} name="VAN pensions capi (cum.)" dot={false} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* SECTION 4: DATA TABLE */}
      <section className="section">
        <div className="collapsible-header" onClick={() => setShowTable(!showTable)}>
          <span className={`arrow ${showTable ? 'open' : ''}`}>▶</span>
          <h2 style={{ border: 'none', margin: 0, padding: 0 }}>Tableau de données</h2>
        </div>
        {showTable && (
          <>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Année</th>
                    <th>φ_t</th>
                    <th>Dép. legacy</th>
                    <th>Dép. capi</th>
                    <th>Total pens.</th>
                    <th>Rend. fonds</th>
                    <th>HLM</th>
                    <th>Abatt.</th>
                    <th>Sal.→capi</th>
                    <th>Empl.→leg</th>
                    <th>Empl.→cap</th>
                    <th>Int. dette</th>
                    <th>Flux net</th>
                    <th>Emprunt</th>
                    <th>Rembours.</th>
                    <th>Prélèv.</th>
                    <th>Dette</th>
                    <th>r_d (%)</th>
                    <th>Dette/PIB</th>
                    <th>Capi nom.</th>
                    <th>Capi réel</th>
                    <th>Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.year}>
                      <td>{r.year}</td>
                      <td>{r.cohIdx.toFixed(3)}</td>
                      <td>{r.legacyExp.toFixed(1)}</td>
                      <td>{r.capiPayout.toFixed(1)}</td>
                      <td>{r.totalPensionExp.toFixed(1)}</td>
                      <td>{r.fundReturn.toFixed(1)}</td>
                      <td>{r.hlmProceeds.toFixed(1)}</td>
                      <td>{r.abatement.toFixed(1)}</td>
                      <td>{r.emplC_s.toFixed(1)}</td>
                      <td>{r.emplrToLeg.toFixed(1)}</td>
                      <td>{r.emplrToCap.toFixed(1)}</td>
                      <td>{r.debtInterest.toFixed(1)}</td>
                      <td>{r.netFlow.toFixed(1)}</td>
                      <td>{r.borrowed.toFixed(1)}</td>
                      <td>{r.repaid.toFixed(1)}</td>
                      <td>{r.levy.toFixed(1)}</td>
                      <td>{r.debt.toFixed(0)}</td>
                      <td>{(r.r_d * 100).toFixed(2)}</td>
                      <td>{r.debtRatio.toFixed(1)}%</td>
                      <td>{(r.capi / 1000).toFixed(2)} Tn</td>
                      <td>{(r.capiReal / 1000).toFixed(2)} Tn</td>
                      <td>{(r.spread * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="export-btn" onClick={exportCSV}>Exporter CSV</button>
          </>
        )}
      </section>

      <footer className="footer">
        Modèle: cdc_legacy_fund_model.md v5 — Post-critique — Équations 1–34 —
        <a href="https://github.com" style={{ color: 'var(--color-primary-light)', marginLeft: 4 }}>Source</a>
      </footer>
    </div>
  )
}
