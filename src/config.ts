export const CONTRACT_ADDRESS = (
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  '0xfF53f36e409FBC2d42b15e214801656006A7A226'
) as `0x${string}`

export const EXPLORER_BASE = 'https://explorer-studio.genlayer.com'

// The app's own origin proxies this to Studio (vite.config.ts in dev,
// vercel.json in production). Same-origin means a rate-limited 503/429 arrives
// as a readable status instead of an opaque "Failed to fetch" with no CORS
// headers attached.
export const STUDIO_RPC =
  (import.meta.env.VITE_STUDIO_RPC as string | undefined) || '/api/rpc'

// MetaMask registers networks by absolute URL, so the proxy path cannot be
// used when adding the chain.
export const STUDIO_WALLET_RPC =
  (import.meta.env.VITE_STUDIO_WALLET_RPC as string | undefined) ||
  'https://studio.genlayer.com/api'
export const NETWORK_NAME = 'GenLayer StudioNet'
export const CHAIN_ID = 61999
