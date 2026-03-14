import { useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { usePoints, LEAGUES, PERFORMANCE_FEE } from '../hooks/usePoints'

export function PointsCard() {
  const { isConnected } = useAccount()
  const { points, league, depositUsd, loading } = usePoints()
  const shareRef = useRef<HTMLDivElement>(null)

  const formatPoints = (pts: number) => {
    if (pts >= 1_000_000) return `${(pts / 1_000_000).toFixed(1)}M`
    if (pts >= 1_000) return `${(pts / 1_000).toFixed(1)}K`
    return pts.toFixed(0)
  }

  const formatUsd = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
    if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
    return `$${val.toFixed(2)}`
  }

  // Progress to next league
  const currentLeagueIdx = LEAGUES.findIndex(l => l.name === league.name)
  const nextLeague = LEAGUES[currentLeagueIdx + 1]
  const progress = nextLeague
    ? ((points - league.minPoints) / (nextLeague.minPoints - league.minPoints)) * 100
    : 100

  const feePercent = Math.round(PERFORMANCE_FEE * 100)

  const handleSaveImage = useCallback(async () => {
    const el = shareRef.current
    if (!el) return
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 400
      canvas.height = 280

      ctx.fillStyle = '#0f1923'
      ctx.roundRect(0, 0, 400, 280, 16)
      ctx.fill()

      ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)'
      ctx.lineWidth = 1
      for (let r = 30; r < 200; r += 25) {
        ctx.beginPath()
        ctx.arc(200, 120, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.fillStyle = '#e4e6f0'
      ctx.font = 'bold 18px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Louis', 200, 50)

      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.fillText('My points on Louis', 200, 110)
      ctx.fillStyle = '#3b82f6'
      ctx.font = 'bold 36px Inter, sans-serif'
      ctx.fillText(formatPoints(points), 200, 155)

      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`League: `, 60, 230)
      ctx.fillStyle = league.color
      ctx.font = 'bold 13px Inter, sans-serif'
      ctx.fillText(league.name, 115, 230)

      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`Deposited: ${formatUsd(depositUsd)}`, 340, 230)

      canvas.toBlob(async (blob) => {
        if (!blob) return
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          alert('Copied to clipboard!')
        } catch {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'louis-points.png'
          a.click()
          URL.revokeObjectURL(url)
        }
      })
    } catch {
      alert('Could not generate image')
    }
  }, [points, league, depositUsd])

  if (!isConnected) {
    return (
      <div className="points-section">
        <div className="points-header">
          <h2 className="points-title">Points</h2>
          <span className="points-subtitle">Connect wallet to view points</span>
        </div>

        {/* How it works even when not connected */}
        <div className="points-info-box">
          <div className="points-info-title">How It Works</div>
          <ul className="points-info-list">
            <li>Deposit $1 in the vault = <strong>1 point</strong></li>
            <li>You earn yield normally — {feePercent}% fee goes to <strong>$LOUIS buybacks</strong></li>
            <li>Keep your deposit until TGE to <strong>keep your points</strong></li>
            <li>Withdraw anytime — you get your yield, but lose your points</li>
            <li>At TGE: convert points to <strong>$LOUIS</strong> or exercise a <strong>put option</strong></li>
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="points-section">
      <div className="points-header">
        <h2 className="points-title">Points</h2>
        <span className="points-subtitle">1 point per $1 deposited</span>
      </div>

      {/* Points + Deposit Summary */}
      <div className="points-grid points-grid-3">
        {/* Total Points */}
        <div className="points-card">
          <span className="points-card-label">Your Points</span>
          <span className="points-card-value" style={{ color: 'var(--accent)' }}>
            {loading ? '—' : formatPoints(points)}
          </span>
        </div>

        {/* Deposited */}
        <div className="points-card">
          <span className="points-card-label">Deposited</span>
          <span className="points-card-value">
            {loading ? '—' : formatUsd(depositUsd)}
          </span>
        </div>

        {/* League */}
        <div className="points-card">
          <span className="points-card-label">League</span>
          <span className="points-card-value" style={{ color: league.color }}>
            {league.name}
          </span>
        </div>
      </div>

      {/* Vesting Banner */}
      {depositUsd > 0 && (
        <div className="points-vesting-banner">
          <div className="vesting-status">
            <span className="vesting-dot" />
            <span>Points active — keep deposited until TGE</span>
          </div>
          <div className="vesting-note">
            {feePercent}% of your yield goes to $LOUIS buybacks · {100 - feePercent}% is yours to keep
          </div>
        </div>
      )}

      {depositUsd === 0 && !loading && (
        <div className="points-vesting-banner" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.06)' }}>
          <div className="vesting-status">
            <span className="vesting-dot" style={{ background: '#ef4444' }} />
            <span>No deposit — deposit to earn points</span>
          </div>
          <div className="vesting-note">
            Go to the Vault tab and deposit stablecoins to start earning points
          </div>
        </div>
      )}

      {/* League Progress */}
      {nextLeague && (
        <div className="points-progress-section">
          <div className="points-progress-label">
            <span>{league.name}</span>
            <span>{nextLeague.name} ({nextLeague.minPoints.toLocaleString()} pts)</span>
          </div>
          <div className="points-progress-bar">
            <div
              className="points-progress-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* How It Works */}
      <div className="points-info-box">
        <div className="points-info-title">How It Works</div>
        <ul className="points-info-list">
          <li>Deposit $1 in the vault = <strong>1 point</strong></li>
          <li>You earn yield normally — {feePercent}% fee goes to <strong>$LOUIS buybacks</strong></li>
          <li>Keep your deposit until TGE to <strong>keep your points</strong></li>
          <li>Withdraw anytime — you get your yield, but lose your points</li>
        </ul>
      </div>

      {/* TGE Info */}
      <div className="points-tge-box">
        <div className="points-tge-title">At TGE</div>
        <div className="points-tge-options">
          <div className="points-tge-option">
            <div>
              <strong>Convert to $LOUIS</strong>
              <span className="tge-option-desc">Redeem your points for tokens at a fixed ratio</span>
            </div>
          </div>
          <div className="points-tge-option">
            <div>
              <strong>Put Option</strong>
              <span className="tge-option-desc">Guaranteed floor price — protection if token drops</span>
            </div>
          </div>
        </div>
      </div>

      {/* Share Card */}
      <div className="points-card points-card-share" style={{ marginBottom: 20 }}>
        <span className="points-card-label">Share Your Points</span>
        <div className="points-share-preview" ref={shareRef}>
          <div className="points-share-rings">
            <div className="points-share-ring r1" />
            <div className="points-share-ring r2" />
            <div className="points-share-ring r3" />
          </div>
          <span className="points-share-logo">Louis</span>
          <span className="points-share-text">My points on Louis</span>
          <span className="points-share-value" style={{ color: '#3b82f6' }}>
            {formatPoints(points)}
          </span>
          <div className="points-share-footer">
            <span>League: <strong style={{ color: league.color }}>{league.name}</strong></span>
          </div>
        </div>
        <button className="points-save-btn" onClick={handleSaveImage}>
          ↓ Save Image
        </button>
      </div>

      {/* All Leagues */}
      <div className="points-leagues">
        {LEAGUES.map((l) => (
          <div
            key={l.name}
            className={`points-league-item ${l.name === league.name ? 'active' : ''}`}
          >
            <span className="points-league-name" style={{ color: l.name === league.name ? l.color : undefined }}>
              {l.name}
            </span>
            <span className="points-league-req">{l.minPoints.toLocaleString()}+</span>
          </div>
        ))}
      </div>
    </div>
  )
}
