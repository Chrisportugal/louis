import { useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { usePoints, LEAGUES } from '../hooks/usePoints'

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

  const handleSaveImage = useCallback(async () => {
    const el = shareRef.current
    if (!el) return
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 400
      canvas.height = 280

      // Black background
      ctx.fillStyle = '#000000'
      ctx.roundRect(0, 0, 400, 280, 16)
      ctx.fill()

      // Subtle rings
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
      ctx.lineWidth = 1
      for (let r = 30; r < 200; r += 25) {
        ctx.beginPath()
        ctx.arc(200, 120, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Logo
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 18px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Louis', 200, 50)

      // Label
      ctx.fillStyle = '#888888'
      ctx.font = '13px Inter, sans-serif'
      ctx.fillText('Points', 200, 110)

      // Points value
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 36px Inter, sans-serif'
      ctx.fillText(formatPoints(points), 200, 155)

      // League info
      ctx.fillStyle = '#888888'
      ctx.font = '13px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`League: `, 60, 230)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 13px Inter, sans-serif'
      ctx.fillText(league.name, 115, 230)

      ctx.fillStyle = '#888888'
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
        </div>
        <div className="connect-prompt">Connect wallet to view points</div>
      </div>
    )
  }

  return (
    <div className="points-section">
      <div className="points-header">
        <h2 className="points-title">Points</h2>
      </div>

      {/* Points + Deposit Summary */}
      <div className="points-grid points-grid-3">
        <div className="points-card">
          <span className="points-card-label">Points</span>
          <span className="points-card-value">
            {loading ? '\u2014' : formatPoints(points)}
          </span>
        </div>

        <div className="points-card">
          <span className="points-card-label">Deposited</span>
          <span className="points-card-value">
            {loading ? '\u2014' : formatUsd(depositUsd)}
          </span>
        </div>

        <div className="points-card">
          <span className="points-card-label">League</span>
          <span className="points-card-value">
            {league.name}
          </span>
        </div>
      </div>

      {/* League Progress */}
      {nextLeague && (
        <div className="points-progress-section">
          <div className="points-progress-label">
            <span>{league.name}</span>
            <span>{nextLeague.name}</span>
          </div>
          <div className="points-progress-bar">
            <div
              className="points-progress-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Share Card */}
      <div className="points-card points-card-share" style={{ marginBottom: 20 }}>
        <span className="points-card-label">Share</span>
        <div className="points-share-preview" ref={shareRef}>
          <div className="points-share-rings">
            <div className="points-share-ring r1" />
            <div className="points-share-ring r2" />
            <div className="points-share-ring r3" />
          </div>
          <span className="points-share-logo">Louis</span>
          <span className="points-share-value">
            {formatPoints(points)}
          </span>
          <div className="points-share-footer">
            <span>{league.name}</span>
          </div>
        </div>
        <button className="points-save-btn" onClick={handleSaveImage}>
          Save Image
        </button>
      </div>

      {/* Leagues */}
      <div className="points-leagues">
        {LEAGUES.map((l) => (
          <div
            key={l.name}
            className={`points-league-item ${l.name === league.name ? 'active' : ''}`}
          >
            <span className="points-league-name">
              {l.name}
            </span>
            <span className="points-league-req">{l.minPoints.toLocaleString()}+</span>
          </div>
        ))}
      </div>
    </div>
  )
}
