import { useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { usePoints, LEAGUES } from '../hooks/usePoints'

export function PointsCard() {
  const { address, isConnected } = useAccount()
  const { points, league, dailyRate, loading } = usePoints()
  const shareRef = useRef<HTMLDivElement>(null)

  const formatPoints = (pts: number) => {
    if (pts >= 1_000_000) return `${(pts / 1_000_000).toFixed(1)}M`
    if (pts >= 1_000) return `${(pts / 1_000).toFixed(1)}K`
    return pts.toFixed(1)
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
    // Use html2canvas-like approach — just copy to clipboard for now
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = 400
      canvas.height = 280

      // Draw card background
      ctx.fillStyle = '#0f1923'
      ctx.roundRect(0, 0, 400, 280, 16)
      ctx.fill()

      // Draw concentric circles (like Hyperliquid)
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.08)'
      ctx.lineWidth = 1
      for (let r = 30; r < 200; r += 25) {
        ctx.beginPath()
        ctx.arc(200, 120, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Logo
      ctx.fillStyle = '#e4e6f0'
      ctx.font = 'bold 18px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Louis', 200, 50)

      // Points
      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.fillText('My total points on Louis', 200, 110)
      ctx.fillStyle = '#3b82f6'
      ctx.font = 'bold 36px Inter, sans-serif'
      ctx.fillText(formatPoints(points), 200, 155)

      // League + rank
      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`League: `, 60, 230)
      ctx.fillStyle = league.color
      ctx.font = 'bold 13px Inter, sans-serif'
      ctx.fillText(`${league.icon} ${league.name}`, 115, 230)

      ctx.fillStyle = '#8b8fa3'
      ctx.font = '13px Inter, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`Rate: ${dailyRate.toFixed(1)} pts/day`, 340, 230)

      canvas.toBlob(async (blob) => {
        if (!blob) return
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          alert('Copied to clipboard!')
        } catch {
          // Fallback: download
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
  }, [points, league, dailyRate])

  if (!isConnected) {
    return (
      <div className="points-section">
        <div className="points-header">
          <h2 className="points-title">Points</h2>
          <span className="points-subtitle">Connect wallet to view points</span>
        </div>
      </div>
    )
  }

  return (
    <div className="points-section">
      <div className="points-header">
        <h2 className="points-title">Points</h2>
        <span className="points-subtitle">1 point per $1 deposited per day</span>
      </div>

      <div className="points-grid">
        {/* Total Points */}
        <div className="points-card">
          <span className="points-card-label">Total Points</span>
          <span className="points-card-value">
            {loading ? '—' : formatPoints(points)}
          </span>
        </div>

        {/* Daily Rate */}
        <div className="points-card">
          <span className="points-card-label">Earning Rate</span>
          <span className="points-card-value">
            {loading ? '—' : `${dailyRate.toFixed(1)}/day`}
          </span>
        </div>

        {/* League */}
        <div className="points-card">
          <span className="points-card-label">League</span>
          <div className="points-card-league">
            <span className="points-league-icon">{league.icon}</span>
            <span className="points-card-value" style={{ color: league.color }}>
              {league.name}
            </span>
          </div>
        </div>

        {/* Share Card */}
        <div className="points-card points-card-share">
          <span className="points-card-label">Share</span>
          <div className="points-share-preview" ref={shareRef}>
            <div className="points-share-rings">
              <div className="points-share-ring r1" />
              <div className="points-share-ring r2" />
              <div className="points-share-ring r3" />
            </div>
            <span className="points-share-logo">Louis</span>
            <span className="points-share-text">My total points on Louis</span>
            <span className="points-share-value" style={{ color: '#3b82f6' }}>
              {formatPoints(points)}
            </span>
            <div className="points-share-footer">
              <span>League: <strong style={{ color: league.color }}>{league.icon} {league.name}</strong></span>
            </div>
          </div>
          <button className="points-save-btn" onClick={handleSaveImage}>
            ↓ Save Image
          </button>
        </div>
      </div>

      {/* League Progress */}
      {nextLeague && (
        <div className="points-progress-section">
          <div className="points-progress-label">
            <span>{league.icon} {league.name}</span>
            <span>{nextLeague.icon} {nextLeague.name} ({nextLeague.minPoints.toLocaleString()} pts)</span>
          </div>
          <div className="points-progress-bar">
            <div
              className="points-progress-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* All Leagues */}
      <div className="points-leagues">
        {LEAGUES.map((l) => (
          <div
            key={l.name}
            className={`points-league-item ${l.name === league.name ? 'active' : ''}`}
          >
            <span className="points-league-badge">{l.icon}</span>
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
