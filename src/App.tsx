import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  connectWallet,
  createProcurement,
  finalizeProcurement,
  getBids,
  getConnectedWallet,
  getProcurement,
  submitBid,
} from './genlayer'
import { CONTRACT_ADDRESS, EXPLORER_BASE, NETWORK_NAME } from './config'
import type { Bid, Procurement, TxNotice } from './types'

type Tab = 'marketplace' | 'create' | 'activity'

const KNOWN_IDS_KEY = 'tenderfit:knownProcurements'
const LAST_ID_KEY = 'tenderfit:lastProcurementId'

function shortAddress(address?: string | null) {
  if (!address) return 'Not connected'
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

function formatDeadline(timestamp: number) {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message
    const rollback = message.match(/\[rollback\]\s*([^\n]+)/i)
    if (rollback?.[1]) return rollback[1]
    return message.length > 220 ? `${message.slice(0, 220)}…` : message
  }
  return 'Unexpected error'
}

function readKnownIds(): number[] {
  try {
    const raw = localStorage.getItem(KNOWN_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x) => Number.isInteger(x) && x > 0).slice(0, 20)
      : []
  } catch {
    return []
  }
}

function rememberId(id: number) {
  const ids = readKnownIds()
  const next = [id, ...ids.filter((x) => x !== id)].slice(0, 20)
  localStorage.setItem(KNOWN_IDS_KEY, JSON.stringify(next))
  localStorage.setItem(LAST_ID_KEY, String(id))
  return next
}

function statusClass(status: string) {
  if (status === 'RESOLVED') return 'status-success'
  if (status === 'NO_AWARD') return 'status-neutral'
  return 'status-open'
}

export default function App() {
  const [tab, setTab] = useState<Tab>('marketplace')
  const [wallet, setWallet] = useState<`0x${string}` | null>(null)
  const [walletBusy, setWalletBusy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txNotice, setTxNotice] = useState<TxNotice | null>(null)

  const initialId = Number(localStorage.getItem(LAST_ID_KEY) || '1') || 1
  const [procurementIdInput, setProcurementIdInput] = useState(String(initialId))
  const [procurement, setProcurement] = useState<Procurement | null>(null)
  const [bids, setBids] = useState<Bid[]>([])
  const [knownIds, setKnownIds] = useState<number[]>(readKnownIds())

  const [bidPrice, setBidPrice] = useState('')
  const [bidProposal, setBidProposal] = useState('')

  const [createTitle, setCreateTitle] = useState('')
  const [createBrief, setCreateBrief] = useState('')
  const [createBudget, setCreateBudget] = useState('')
  const [createDeadline, setCreateDeadline] = useState(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000)
    d.setSeconds(0, 0)
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
  })

  useEffect(() => {
    getConnectedWallet().then(setWallet).catch(() => undefined)

    const provider = window.ethereum
    if (!provider?.on) return

    const handler = (...args: unknown[]) => {
      const accounts = args[0]
      if (Array.isArray(accounts) && typeof accounts[0] === 'string') {
        setWallet(accounts[0] as `0x${string}`)
      } else {
        setWallet(null)
      }
    }

    provider.on('accountsChanged', handler)
    return () => provider.removeListener?.('accountsChanged', handler)
  }, [])

  const walletBid = useMemo(
    () => bids.find((bid) => sameAddress(bid.bidder, wallet)) || null,
    [bids, wallet],
  )

  const isBuyer = sameAddress(procurement?.buyer, wallet)
  const deadlinePassed = Boolean(
    procurement && Math.floor(Date.now() / 1000) >= procurement.bidding_deadline,
  )

  const canFinalize = Boolean(
    procurement && procurement.status === 'OPEN' && deadlinePassed,
  )

  const canBid = Boolean(
    procurement &&
      procurement.status === 'OPEN' &&
      !deadlinePassed &&
      wallet &&
      !isBuyer &&
      !walletBid,
  )

  const stage = !procurement
    ? 0
    : procurement.status !== 'OPEN' || deadlinePassed
      ? 3
      : procurement.bid_count > 0
        ? 2
        : 1

  async function handleConnect() {
    setWalletBusy(true)
    setError(null)
    try {
      const address = await connectWallet()
      setWallet(address)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setWalletBusy(false)
    }
  }

  async function loadProcurement(idOverride?: number) {
    const id = idOverride ?? Number(procurementIdInput)
    if (!Number.isInteger(id) || id <= 0) {
      setError('Enter a valid procurement ID.')
      return
    }

    setBusy('load')
    setError(null)
    try {
      const [nextProcurement, nextBids] = await Promise.all([
        getProcurement(id),
        getBids(id),
      ])
      setProcurement(nextProcurement)
      setBids(nextBids)
      setProcurementIdInput(String(id))
      setKnownIds(rememberId(id))
      setTab('marketplace')
    } catch (e) {
      setProcurement(null)
      setBids([])
      setError(`Could not load procurement #${id}. ${formatError(e)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!wallet) {
      setError('Connect MetaMask before creating a procurement.')
      return
    }

    const budget = Number(createBudget)
    const deadline = Math.floor(new Date(createDeadline).getTime() / 1000)

    if (!createTitle.trim() || !createBrief.trim()) {
      setError('Title and brief are required.')
      return
    }
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      setError('Max budget must be a positive integer.')
      return
    }
    if (!Number.isFinite(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
      setError('Deadline must be in the future.')
      return
    }

    setBusy('create')
    setError(null)
    setTxNotice(null)
    try {
      const hash = await createProcurement(
        wallet,
        createTitle.trim(),
        createBrief.trim(),
        budget,
        deadline,
      )
      setTxNotice({ hash, label: 'Procurement created', submittedAt: Date.now() })
      setCreateTitle('')
      setCreateBrief('')
      setCreateBudget('')
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmitBid(event: FormEvent) {
    event.preventDefault()

    if (!wallet || !procurement) {
      setError('Connect a wallet and load a procurement first.')
      return
    }

    const price = Number(bidPrice)

    if (!Number.isSafeInteger(price) || price <= 0) {
      setError('Bid price must be a positive integer.')
      return
    }
    if (price > procurement.max_budget) {
      setError(`Bid price cannot exceed the max budget (${procurement.max_budget}).`)
      return
    }
    if (!bidProposal.trim()) {
      setError('Proposal text is required.')
      return
    }

    setBusy('bid')
    setError(null)
    setTxNotice(null)

    try {
      const hash = await submitBid(
        wallet,
        procurement.procurement_id,
        price,
        bidProposal.trim(),
      )
      setTxNotice({
        hash,
        label: `Bid submitted to #${procurement.procurement_id}`,
        submittedAt: Date.now(),
      })
      setBidPrice('')
      setBidProposal('')
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleFinalize() {
    if (!wallet || !procurement) {
      setError('Connect a wallet before finalizing.')
      return
    }

    setBusy('finalize')
    setError(null)
    setTxNotice(null)

    try {
      const hash = await finalizeProcurement(wallet, procurement.procurement_id)
      setTxNotice({
        hash,
        label: `Finalize #${procurement.procurement_id}`,
        submittedAt: Date.now(),
      })
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(null)
    }
  }

  const nextGuess = knownIds.length ? Math.max(...knownIds) + 1 : 1

  function renderNextAction() {
    if (!procurement) return null

    if (procurement.status === 'RESOLVED') {
      return (
        <div className="action-result action-success">
          <span className="action-icon">✓</span>
          <div>
            <span className="overline">Procurement awarded</span>
            <strong>{shortAddress(procurement.winner_address)}</strong>
            <p>Winning price: {formatNumber(procurement.winning_price)}</p>
          </div>
        </div>
      )
    }

    if (procurement.status === 'NO_AWARD') {
      return (
        <div className="action-result">
          <span className="action-icon">—</span>
          <div>
            <span className="overline">Final result</span>
            <strong>No award</strong>
            <p>No qualified bid was available at finalization.</p>
          </div>
        </div>
      )
    }

    if (!wallet) {
      return (
        <div className="action-block">
          <h3>Connect your wallet</h3>
          <p>Connect MetaMask to submit a bid or finalize an eligible procurement.</p>
          <button className="button button-primary button-wide" onClick={handleConnect}>
            Connect wallet
          </button>
        </div>
      )
    }

    if (isBuyer) {
      if (canFinalize) {
        return (
          <div className="action-block">
            <span className="overline">Buyer action</span>
            <h3>Ready to finalize</h3>
            <p>Bidding is closed. The contract will select the lowest-priced qualified bid.</p>
            <button
              className="button button-primary button-wide"
              onClick={handleFinalize}
              disabled={busy === 'finalize'}
            >
              {busy === 'finalize' ? 'Submitting…' : 'Finalize procurement'}
            </button>
          </div>
        )
      }

      return (
        <div className="action-result">
          <span className="action-icon">B</span>
          <div>
            <span className="overline">You are the buyer</span>
            <strong>{deadlinePassed ? 'Bidding closed' : 'Waiting for supplier bids'}</strong>
            <p>Buyer self-bidding is blocked by the contract.</p>
          </div>
        </div>
      )
    }

    if (walletBid) {
      return (
        <div className={`action-result ${walletBid.qualified ? 'action-success' : 'action-danger'}`}>
          <span className="action-icon">{walletBid.qualified ? '✓' : '×'}</span>
          <div>
            <span className="overline">Your bid #{walletBid.bid_id}</span>
            <strong>{walletBid.qualified ? 'Qualified' : 'Not qualified'}</strong>
            <p>Offer: {formatNumber(walletBid.price)}</p>
          </div>
        </div>
      )
    }

    if (!canBid) {
      return (
        <div className="action-result">
          <span className="action-icon">⏱</span>
          <div>
            <span className="overline">Supplier action</span>
            <strong>Bidding is closed</strong>
            <p>Wait for finalization to see the award result.</p>
          </div>
        </div>
      )
    }

    return (
      <form className="bid-form" onSubmit={handleSubmitBid}>
        <span className="overline">Supplier action</span>
        <h3>Submit a bid</h3>
        <p className="form-intro">
          Price is checked by the contract. Your proposal is evaluated by GenLayer.
        </p>

        <label>
          <span>Bid price</span>
          <input
            inputMode="numeric"
            value={bidPrice}
            onChange={(e) => setBidPrice(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={`Maximum ${formatNumber(procurement.max_budget)}`}
          />
        </label>

        <label>
          <span>Proposal</span>
          <textarea
            rows={7}
            value={bidProposal}
            onChange={(e) => setBidProposal(e.target.value)}
            placeholder="Explain exactly how you satisfy every mandatory requirement."
          />
        </label>

        <div className="info-note">
          <b>AI checks fit only.</b>
          <span>Other bids and price ranking are not included in the AI judgment.</span>
        </div>

        <button
          className="button button-primary button-wide"
          type="submit"
          disabled={busy === 'bid'}
        >
          {busy === 'bid' ? 'Submitting to GenLayer…' : 'Submit for qualification'}
        </button>
      </form>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button className="brand" onClick={() => setTab('marketplace')}>
            <span className="brand-mark">TF</span>
            <span className="brand-copy">
              <strong>TenderFit</strong>
              <small>AI-qualified procurement</small>
            </span>
          </button>

          <nav className="main-nav" aria-label="TenderFit sections">
            <button
              className={tab === 'marketplace' ? 'active' : ''}
              onClick={() => setTab('marketplace')}
            >
              Marketplace
            </button>
            <button
              className={tab === 'create' ? 'active' : ''}
              onClick={() => setTab('create')}
            >
              Create
            </button>
            <button
              className={tab === 'activity' ? 'active' : ''}
              onClick={() => setTab('activity')}
            >
              My activity
            </button>
          </nav>

          <div className="header-actions">
            <span className="network-chip"><i /> {NETWORK_NAME}</span>
            <button className="wallet-button" onClick={handleConnect} disabled={walletBusy}>
              <span className={wallet ? 'wallet-dot connected' : 'wallet-dot'} />
              {walletBusy ? 'Connecting…' : wallet ? shortAddress(wallet) : 'Connect wallet'}
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="page-intro">
          {tab === 'marketplace' && (
            <>
              <span className="overline">Procurement marketplace</span>
              <h1>AI checks the fit. The contract picks the price.</h1>
              <p>
                Suppliers are judged against the brief one bid at a time. Among qualified bids,
                the lowest price wins deterministically.
              </p>
            </>
          )}

          {tab === 'create' && (
            <>
              <span className="overline">Buyer workspace</span>
              <h1>Create a clear procurement brief.</h1>
              <p>
                State the mandatory requirements, set the budget and deadline, then let GenLayer
                qualify supplier proposals.
              </p>
            </>
          )}

          {tab === 'activity' && (
            <>
              <span className="overline">Wallet view</span>
              <h1>Your TenderFit activity.</h1>
              <p>
                See your role and accepted on-chain activity for the procurement currently loaded.
              </p>
            </>
          )}
        </section>

        {error && (
          <div className="notice notice-error">
            <div>
              <strong>Action failed</strong>
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} aria-label="Dismiss error">×</button>
          </div>
        )}

        {txNotice && (
          <div className="notice notice-tx">
            <div className="notice-content">
              <span className="notice-dot" />
              <div>
                <strong>{txNotice.label}</strong>
                <span>Transaction submitted. Refresh after consensus/finalization.</span>
                <code>{txNotice.hash}</code>
              </div>
            </div>
            <div className="notice-actions">
              {procurement && (
                <button
                  className="button button-secondary button-small"
                  onClick={() => loadProcurement(procurement.procurement_id)}
                  disabled={busy === 'load'}
                >
                  Refresh state
                </button>
              )}
              <button className="icon-button" onClick={() => setTxNotice(null)} aria-label="Dismiss">×</button>
            </div>
          </div>
        )}

        {tab === 'marketplace' && (
          <section className="workspace">
            <div className="lookup-bar">
              <div className="lookup-title">
                <span className="overline">Open procurement</span>
                <strong>Load authoritative on-chain state</strong>
              </div>

              <div className="lookup-controls">
                <div className="id-input">
                  <span>#</span>
                  <input
                    inputMode="numeric"
                    value={procurementIdInput}
                    onChange={(e) => setProcurementIdInput(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="ID"
                  />
                </div>
                <button
                  className="button button-primary"
                  onClick={() => loadProcurement()}
                  disabled={busy === 'load'}
                >
                  {busy === 'load' ? 'Loading…' : 'Load'}
                </button>
              </div>

              {knownIds.length > 0 && (
                <div className="recent-ids">
                  <span>Recent:</span>
                  {knownIds.slice(0, 5).map((id) => (
                    <button key={id} onClick={() => loadProcurement(id)}>#{id}</button>
                  ))}
                </div>
              )}
            </div>

            {!procurement ? (
              <div className="empty-dashboard">
                <div className="empty-copy">
                  <span className="empty-icon">TF</span>
                  <h2>Load a procurement to begin.</h2>
                  <p>
                    Enter an ID above to see the brief, AI qualification results and final award.
                  </p>
                </div>

                <div className="how-grid">
                  <div><b>1</b><strong>Brief</strong><span>Buyer defines mandatory requirements.</span></div>
                  <div><b>2</b><strong>Qualification</strong><span>GenLayer returns qualified true/false.</span></div>
                  <div><b>3</b><strong>Award</strong><span>Lowest-priced qualified bid wins.</span></div>
                </div>
              </div>
            ) : (
              <>
                <div className="overview-card">
                  <div className="overview-head">
                    <div>
                      <div className="status-line">
                        <span className={`status-pill ${statusClass(procurement.status)}`}>
                          {procurement.status === 'OPEN'
                            ? deadlinePassed ? 'BIDDING CLOSED' : 'OPEN'
                            : procurement.status}
                        </span>
                        <span>Procurement #{procurement.procurement_id}</span>
                      </div>
                      <h2>{procurement.title}</h2>
                      <p>{procurement.brief}</p>
                    </div>

                    <a
                      className="explorer-link"
                      href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View contract ↗
                    </a>
                  </div>

                  <div className="stats">
                    <div><span>Max budget</span><strong>{formatNumber(procurement.max_budget)}</strong></div>
                    <div><span>Deadline</span><strong>{formatDeadline(procurement.bidding_deadline)}</strong></div>
                    <div><span>Bids</span><strong>{procurement.bid_count}</strong></div>
                    <div><span>Buyer</span><strong title={procurement.buyer}>{shortAddress(procurement.buyer)}</strong></div>
                  </div>

                  <div className="stage-strip">
                    {[
                      ['1', 'Brief'],
                      ['2', 'AI qualification'],
                      ['3', 'Award'],
                    ].map(([number, label], index) => {
                      const step = index + 1
                      return (
                        <div className={`stage-step ${stage >= step ? 'done' : ''} ${stage === step ? 'current' : ''}`} key={label}>
                          <b>{stage > step ? '✓' : number}</b>
                          <span>{label}</span>
                        </div>
                      )
                    })}
                  </div>

                  {procurement.status === 'RESOLVED' && (
                    <div className="award-summary">
                      <span className="award-check">✓</span>
                      <div>
                        <span>Winning supplier</span>
                        <strong>{shortAddress(procurement.winner_address)}</strong>
                      </div>
                      <div>
                        <span>Winning price</span>
                        <strong>{formatNumber(procurement.winning_price)}</strong>
                      </div>
                      <div>
                        <span>Winning bid</span>
                        <strong>#{procurement.winner_bid_id}</strong>
                      </div>
                    </div>
                  )}

                  {procurement.status === 'NO_AWARD' && (
                    <div className="no-award">
                      <strong>No award</strong>
                      <span>No qualified bid was available when this procurement was finalized.</span>
                    </div>
                  )}
                </div>

                <div className="market-grid">
                  <div className="bids-panel">
                    <div className="section-head">
                      <div>
                        <span className="overline">Supplier bids</span>
                        <h2>Qualification results</h2>
                      </div>
                      <span className="subtle-chip">On-chain state</span>
                    </div>

                    {bids.length === 0 ? (
                      <div className="empty-list">
                        <strong>No bids yet</strong>
                        <span>Accepted supplier bids will appear here after consensus.</span>
                      </div>
                    ) : (
                      <div className="bid-table">
                        <div className="bid-table-head">
                          <span>Supplier / proposal</span>
                          <span>AI fit</span>
                          <span>Price</span>
                        </div>

                        {bids.map((bid) => {
                          const isWinner = procurement.winner_bid_id === bid.bid_id
                          return (
                            <article className={`bid-item ${isWinner ? 'winner' : ''}`} key={bid.bid_id}>
                              <div className="bid-copy">
                                <div className="bid-title-line">
                                  <strong>Bid #{bid.bid_id}</strong>
                                  <span>{shortAddress(bid.bidder)}</span>
                                  {sameAddress(bid.bidder, wallet) && <i>YOU</i>}
                                  {isWinner && <em>WINNER</em>}
                                </div>
                                <p>{bid.proposal_text}</p>
                              </div>

                              <div>
                                <span className={`fit-pill ${bid.qualified ? 'qualified' : 'rejected'}`}>
                                  {bid.qualified ? '✓ Qualified' : '× Not qualified'}
                                </span>
                              </div>

                              <strong className="bid-price">{formatNumber(bid.price)}</strong>
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <aside className="action-panel">
                    <div className="section-head compact">
                      <div>
                        <span className="overline">Next action</span>
                        <h2>What happens now?</h2>
                      </div>
                    </div>
                    {renderNextAction()}

                    {procurement.status === 'OPEN' && (
                      <button
                        className="button button-secondary button-wide refresh-button"
                        onClick={() => loadProcurement(procurement.procurement_id)}
                        disabled={busy === 'load'}
                      >
                        {busy === 'load' ? 'Refreshing…' : 'Refresh on-chain state'}
                      </button>
                    )}
                  </aside>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'create' && (
          <section className="create-workspace">
            <form className="create-panel" onSubmit={handleCreate}>
              <div className="form-section">
                <div className="section-number">1</div>
                <div className="form-section-body">
                  <div className="form-section-head">
                    <h2>Job details</h2>
                    <span>Make every mandatory requirement explicit.</span>
                  </div>

                  <label>
                    <span>Title</span>
                    <input
                      value={createTitle}
                      onChange={(e) => setCreateTitle(e.target.value)}
                      maxLength={120}
                      placeholder="Smart Contract Security Audit"
                    />
                  </label>

                  <label>
                    <span>Procurement brief</span>
                    <textarea
                      value={createBrief}
                      onChange={(e) => setCreateBrief(e.target.value)}
                      rows={8}
                      maxLength={4000}
                      placeholder="Example: Audit Contract A and Contract B, include manual security review, provide a written vulnerability report, and deliver within 14 days."
                    />
                    <small>{createBrief.length}/4000</small>
                  </label>
                </div>
              </div>

              <div className="form-divider" />

              <div className="form-section">
                <div className="section-number">2</div>
                <div className="form-section-body">
                  <div className="form-section-head">
                    <h2>Budget & deadline</h2>
                    <span>These rules are enforced deterministically by the contract.</span>
                  </div>

                  <div className="two-col">
                    <label>
                      <span>Max budget</span>
                      <input
                        inputMode="numeric"
                        value={createBudget}
                        onChange={(e) => setCreateBudget(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="15000"
                      />
                    </label>

                    <label>
                      <span>Bidding deadline</span>
                      <input
                        type="datetime-local"
                        value={createDeadline}
                        onChange={(e) => setCreateDeadline(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-divider" />

              <div className="form-section">
                <div className="section-number">3</div>
                <div className="form-section-body">
                  <div className="form-section-head">
                    <h2>Publish</h2>
                    <span>The brief is immutable after creation.</span>
                  </div>

                  <div className="publish-note">
                    <strong>How TenderFit decides</strong>
                    <p>
                      GenLayer judges semantic fit for each proposal. The contract enforces budget,
                      deadline and final winner selection.
                    </p>
                  </div>

                  <button
                    className="button button-primary button-wide"
                    type="submit"
                    disabled={busy === 'create' || !wallet}
                  >
                    {busy === 'create'
                      ? 'Submitting…'
                      : wallet
                        ? 'Create procurement'
                        : 'Connect wallet to create'}
                  </button>
                </div>
              </div>
            </form>

            <aside className="create-aside">
              <div className="aside-card">
                <span className="overline">Good brief</span>
                <h3>Write requirements that can be judged.</h3>
                <ul>
                  <li>State required scope explicitly.</li>
                  <li>Separate mandatory items from preferences.</li>
                  <li>Do not ask AI to rank suppliers or price.</li>
                </ul>
              </div>

              <div className="aside-card contract-card">
                <span className="overline">Project contract</span>
                <code>{CONTRACT_ADDRESS}</code>
                <a
                  href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Explorer ↗
                </a>
              </div>
            </aside>
          </section>
        )}

        {tab === 'activity' && (
          <section className="activity-workspace">
            <div className="activity-panel">
              {!wallet ? (
                <div className="empty-list large">
                  <strong>Connect your wallet</strong>
                  <span>TenderFit derives your role from the connected address.</span>
                  <button className="button button-primary" onClick={handleConnect}>
                    Connect wallet
                  </button>
                </div>
              ) : !procurement ? (
                <div className="empty-list large">
                  <strong>No procurement loaded</strong>
                  <span>Load a procurement in Marketplace to see your activity.</span>
                  <button className="button button-secondary" onClick={() => setTab('marketplace')}>
                    Go to Marketplace
                  </button>
                </div>
              ) : (
                <>
                  <div className="activity-wallet">
                    <span className="wallet-avatar">{wallet.slice(2, 4).toUpperCase()}</span>
                    <div>
                      <span className="overline">Connected wallet</span>
                      <strong>{shortAddress(wallet)}</strong>
                    </div>
                    <span className="role-chip">
                      {isBuyer ? 'Buyer' : walletBid ? 'Supplier' : 'Viewer'}
                    </span>
                  </div>

                  <div className="activity-procurement">
                    <div>
                      <span>Procurement #{procurement.procurement_id}</span>
                      <h2>{procurement.title}</h2>
                    </div>
                    <span className={`status-pill ${statusClass(procurement.status)}`}>
                      {procurement.status}
                    </span>
                  </div>

                  <div className="activity-cards">
                    {isBuyer && (
                      <div className="activity-card">
                        <span className="activity-icon">B</span>
                        <div>
                          <span className="overline">Buyer</span>
                          <strong>{procurement.bid_count} submitted bid{procurement.bid_count === 1 ? '' : 's'}</strong>
                          <p>Budget {formatNumber(procurement.max_budget)} · {formatDeadline(procurement.bidding_deadline)}</p>
                        </div>
                      </div>
                    )}

                    {walletBid && (
                      <div className="activity-card">
                        <span className={`activity-icon ${walletBid.qualified ? 'positive' : 'negative'}`}>
                          {walletBid.qualified ? '✓' : '×'}
                        </span>
                        <div>
                          <span className="overline">Your bid #{walletBid.bid_id}</span>
                          <strong>{walletBid.qualified ? 'Qualified' : 'Not qualified'} · {formatNumber(walletBid.price)}</strong>
                          <p>
                            {procurement.winner_bid_id === walletBid.bid_id
                              ? 'This bid won the procurement.'
                              : procurement.status === 'RESOLVED'
                                ? 'This bid was not the final winner.'
                                : 'Awaiting finalization.'}
                          </p>
                        </div>
                      </div>
                    )}

                    {!isBuyer && !walletBid && (
                      <div className="empty-list">
                        <strong>No accepted activity for this wallet</strong>
                        <span>This wallet has not created or submitted a bid to the loaded procurement.</span>
                      </div>
                    )}
                  </div>

                  <button
                    className="button button-secondary"
                    onClick={() => loadProcurement(procurement.procurement_id)}
                    disabled={busy === 'load'}
                  >
                    Refresh on-chain state
                  </button>
                </>
              )}
            </div>

            <aside className="activity-aside">
              <div className="aside-card">
                <span className="overline">Recently opened</span>
                <h3>Local procurement IDs</h3>
                <p>
                  TenderFit remembers IDs opened on this device. Displayed state is always re-read from the contract.
                </p>

                <div className="recent-grid">
                  {knownIds.length
                    ? knownIds.slice(0, 8).map((id) => (
                        <button key={id} onClick={() => loadProcurement(id)}>#{id}</button>
                      ))
                    : <span>No recent IDs</span>}
                </div>

                <button
                  className="button button-secondary button-wide"
                  onClick={() => {
                    setProcurementIdInput(String(nextGuess))
                    setTab('marketplace')
                  }}
                >
                  Try next ID #{nextGuess}
                </button>
              </div>
            </aside>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <div>
          <strong>TenderFit</strong>
          <span>AI-qualified procurement on GenLayer</span>
        </div>
        <div>
          <span>{NETWORK_NAME}</span>
          <code>{shortAddress(CONTRACT_ADDRESS)}</code>
        </div>
      </footer>
    </div>
  )
}
