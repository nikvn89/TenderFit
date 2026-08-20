export type ProcurementStatus = 'OPEN' | 'RESOLVED' | 'NO_AWARD' | string

export type Procurement = {
  procurement_id: number
  buyer: `0x${string}`
  title: string
  brief: string
  max_budget: number
  bidding_deadline: number
  status: ProcurementStatus
  bidding_open: boolean
  bid_count: number
  winner_bid_id: number
  winner_address: `0x${string}`
  winning_price: number
}

export type Bid = {
  bid_id: number
  procurement_id?: number
  bidder: `0x${string}`
  price: number
  proposal_text: string
  qualified: boolean
}

export type Result = {
  procurement_id: number
  status: ProcurementStatus
  winner_bid_id: number
  winner_address: `0x${string}`
  winning_price: number
}

export type TxNotice = {
  hash: `0x${string}`
  label: string
  submittedAt: number
}
