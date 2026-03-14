import { useState, useEffect } from 'react'

const STORAGE_KEY = 'louis-terms-accepted'

export function DisclaimerModal() {
  const [show, setShow] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const accepted = localStorage.getItem(STORAGE_KEY)
    if (!accepted) setShow(true)
  }, [])

  const handleAccept = () => {
    if (!checked) return
    localStorage.setItem(STORAGE_KEY, Date.now().toString())
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="disclaimer-overlay">
      <div className="disclaimer-modal">
        <h2>Terms of Use</h2>

        <div className="disclaimer-content">
          <p>
            By using Louis ("the Protocol"), you agree to the following:
          </p>

          <h3>1. No Investment Advice</h3>
          <p>
            Louis is experimental software. Nothing on this site constitutes financial, investment,
            legal, or tax advice. You are solely responsible for your own investment decisions.
          </p>

          <h3>2. Smart Contract Risk</h3>
          <p>
            The Protocol interacts with unaudited smart contracts on HyperEVM.
            Smart contracts may contain bugs or vulnerabilities that could result in
            partial or total loss of deposited funds. The contracts are non-upgradeable.
          </p>

          <h3>3. Third-Party Protocol Risk</h3>
          <p>
            Louis deposits funds into third-party lending protocols (HyperLend, HypurrFi, Felix).
            These protocols are outside the control of Louis. If any underlying protocol is
            exploited, paused, or becomes insolvent, your funds deposited there may be lost.
          </p>

          <h3>4. No Guarantees</h3>
          <p>
            APY rates are variable and not guaranteed. Past performance does not indicate future results.
            The AI agent may make suboptimal allocation decisions. There is no guarantee of profit.
          </p>

          <h3>5. Assumption of Risk</h3>
          <p>
            You acknowledge that DeFi protocols carry inherent risks including but not limited to:
            smart contract bugs, oracle failures, liquidity crises, regulatory actions, blockchain
            network issues, and loss of private keys. You use the Protocol entirely at your own risk.
          </p>

          <h3>6. Limitation of Liability</h3>
          <p>
            To the maximum extent permitted by law, Louis and its contributors shall not be liable
            for any direct, indirect, incidental, special, or consequential damages arising from
            your use of the Protocol, including loss of funds, profits, or data.
          </p>

          <h3>7. Jurisdictional Compliance</h3>
          <p>
            You are responsible for ensuring that your use of the Protocol complies with
            all applicable laws and regulations in your jurisdiction.
          </p>
        </div>

        <div className="disclaimer-actions">
          <label className="disclaimer-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>I have read and agree to the Terms of Use. I understand the risks involved.</span>
          </label>
          <button
            className="disclaimer-accept"
            onClick={handleAccept}
            disabled={!checked}
            style={{ opacity: checked ? 1 : 0.4, cursor: checked ? 'pointer' : 'not-allowed' }}
          >
            Accept & Continue
          </button>
        </div>
      </div>
    </div>
  )
}
