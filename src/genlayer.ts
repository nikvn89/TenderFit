import { createClient } from 'genlayer-js'
import { TransactionStatus } from 'genlayer-js/types'
import { ensureStudioNet, proxiedChain } from './chain'
import { CONTRACT_ADDRESS } from './config'
import type { Bid, Procurement, Result } from './types'

const readClient = createClient({ chain: proxiedChain })

const RECEIPT_POLL_INTERVAL_MS = 5_000
const RECEIPT_MAX_RETRIES = 60

export type OnHash = (hash: `0x${string}`) => void

function parseContractJson<T>(raw: unknown): T {
  let value: unknown = raw

  for (let i = 0; i < 2; i += 1) {
    if (typeof value !== 'string') break
    try {
      value = JSON.parse(value)
    } catch {
      break
    }
  }

  if (value && typeof value === 'object') {
    return value as T
  }

  throw new Error('Unexpected contract response format')
}

function requireEthereum() {
  if (!window.ethereum) {
    throw new Error('MetaMask was not detected in this browser.')
  }
  return window.ethereum
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = requireEthereum()
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
    throw new Error('No wallet account returned by MetaMask.')
  }

  // Get onto StudioNet at connect time so the first write is not the place the
  // user discovers they are on the wrong network.
  await ensureStudioNet()

  return accounts[0] as `0x${string}`
}

export async function getConnectedWallet(): Promise<`0x${string}` | null> {
  if (!window.ethereum) return null
  const accounts = await window.ethereum.request({ method: 'eth_accounts' })
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') return null
  return accounts[0] as `0x${string}`
}

async function getWriteClient(address: `0x${string}`) {
  const provider = requireEthereum()

  // The wallet must be on StudioNet before anything is signed. See chain.ts
  // for why this is done here instead of by the SDK, and why
  // `client.connect()` is not used.
  await ensureStudioNet()

  return createClient({
    chain: proxiedChain,
    account: address,
    provider: provider as any,
  })
}

/**
 * Reject a transaction that reached the chain and failed there.
 *
 * A GenLayer transaction that reverts at consensus still returns a hash, so a
 * hash on its own says only "submitted". Reporting success from a hash is how
 * a rolled-back write ends up displayed as a completed one.
 *
 * On StudioNet the receipt does not carry `txExecutionResultName`:
 * `waitForTransactionReceipt` routes `isStudio` chains through
 * `decodeLocalnetTransaction`, and only `decodeTransaction` sets that field
 * (genlayer-js 1.1.8). So the enum is checked when present, the leader
 * receipt's execution result when it is not, and neither is treated as a
 * failure when both are absent — the caller re-reads state instead.
 */
function assertNotReverted(receipt: any, label: string) {
  const named = receipt?.txExecutionResultName
  if (typeof named === 'string' && named !== 'FINISHED_WITH_RETURN') {
    throw new Error(`${label} failed on chain: ${named}`)
  }

  const leader = receipt?.consensus_data?.leader_receipt
  const receipts = Array.isArray(leader) ? leader : leader ? [leader] : []
  for (const entry of receipts) {
    const outcome = entry?.execution_result ?? entry?.executionResult
    if (typeof outcome === 'string' && outcome.toUpperCase() !== 'SUCCESS') {
      const reason = entry?.result?.status ?? entry?.result ?? outcome
      throw new Error(`${label} was rolled back on chain: ${reason}`)
    }
  }
}

/** Send a write, then wait for the chain to accept it before returning. */
async function sendAndConfirm(
  wallet: `0x${string}`,
  functionName: string,
  args: unknown[],
  label: string,
  onHash?: OnHash,
) {
  const client = await getWriteClient(wallet)

  const hash = (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as any[],
    value: 0n,
  })) as `0x${string}`

  // Surface the hash immediately; the caller can show "submitted" while the
  // chain decides.
  onHash?.(hash)

  const receipt = await client.waitForTransactionReceipt({
    // genlayer-js brands its hash type by length; the value is the same string.
    hash: hash as unknown as Parameters<
      typeof client.waitForTransactionReceipt
    >[0]['hash'],
    status: TransactionStatus.ACCEPTED,
    interval: RECEIPT_POLL_INTERVAL_MS,
    retries: RECEIPT_MAX_RETRIES,
  })

  assertNotReverted(receipt, label)
  return hash
}

export async function getProcurement(id: number): Promise<Procurement> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_procurement',
    args: [id],
  })
  return parseContractJson<Procurement>(raw)
}

export async function getBids(id: number): Promise<Bid[]> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_bids',
    args: [id],
  })
  return parseContractJson<Bid[]>(raw).map((bid) => ({ ...bid, procurement_id: id }))
}

export async function getResult(id: number): Promise<Result> {
  const raw = await readClient.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_result',
    args: [id],
  })
  return parseContractJson<Result>(raw)
}

export async function createProcurement(
  wallet: `0x${string}`,
  title: string,
  brief: string,
  maxBudget: number,
  biddingDeadline: number,
  attestedRequirementsJson: string,
  onHash?: OnHash,
) {
  return sendAndConfirm(
    wallet,
    'create_procurement',
    [title, brief, maxBudget, biddingDeadline, attestedRequirementsJson],
    'Creating the procurement',
    onHash,
  )
}

export async function submitBid(
  wallet: `0x${string}`,
  procurementId: number,
  price: number,
  proposalText: string,
  onHash?: OnHash,
) {
  return sendAndConfirm(
    wallet,
    'submit_bid',
    [procurementId, price, proposalText],
    'Submitting the bid',
    onHash,
  )
}

export async function attestRequirement(
  wallet: `0x${string}`,
  supplier: string,
  reqKey: string,
  statement: string,
  onHash?: OnHash,
) {
  return sendAndConfirm(
    wallet,
    'attest',
    [supplier, reqKey, statement],
    'Signing the attestation',
    onHash,
  )
}

export async function revokeAttestation(
  wallet: `0x${string}`,
  supplier: string,
  reqKey: string,
  onHash?: OnHash,
) {
  return sendAndConfirm(
    wallet,
    'revoke_attestation',
    [supplier, reqKey],
    'Revoking the attestation',
    onHash,
  )
}

export async function finalizeProcurement(
  wallet: `0x${string}`,
  procurementId: number,
  onHash?: OnHash,
) {
  return sendAndConfirm(
    wallet,
    'finalize_procurement',
    [procurementId],
    'Finalizing the procurement',
    onHash,
  )
}
