import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { CONTRACT_ADDRESS } from './config'
import type { Bid, Procurement, Result } from './types'

const readClient = createClient({ chain: studionet })

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
  const client = createClient({
    chain: studionet,
    account: address,
    provider: provider as any,
  })

  await client.connect('studionet')
  return client
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
) {
  const client = await getWriteClient(wallet)
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'create_procurement',
    args: [title, brief, maxBudget, biddingDeadline],
    value: 0n,
  })
}

export async function submitBid(
  wallet: `0x${string}`,
  procurementId: number,
  price: number,
  proposalText: string,
) {
  const client = await getWriteClient(wallet)
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'submit_bid',
    args: [procurementId, price, proposalText],
    value: 0n,
  })
}

export async function finalizeProcurement(
  wallet: `0x${string}`,
  procurementId: number,
) {
  const client = await getWriteClient(wallet)
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'finalize_procurement',
    args: [procurementId],
    value: 0n,
  })
}
