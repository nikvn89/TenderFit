/// <reference types="vite/client" />

type EthereumRequest = {
  method: string
  params?: unknown[] | Record<string, unknown>
}

interface EthereumProvider {
  request(args: EthereumRequest): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

interface Window {
  ethereum?: EthereumProvider
}
