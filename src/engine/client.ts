import type { Handlers } from './worker'
import type { BlockInfo, DocInfo } from './protocol'

type Args<K extends keyof Handlers> = Parameters<Handlers[K]>[0]
type Ret<K extends keyof Handlers> = Awaited<ReturnType<Handlers[K]>> extends { value: infer V } ? V : Awaited<ReturnType<Handlers[K]>>

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const { reqId, ok, result, error, name, data } = e.data
    const p = pending.get(reqId)
    if (!p) return
    pending.delete(reqId)
    if (ok) p.resolve(result as never)
    else p.reject(new EngineError(error, name, data))
  }
  worker.postMessage({ reqId: 0, method: 'init', args: { base: new URL(import.meta.env.BASE_URL, document.baseURI).href } })
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new EngineError(e.message || 'The PDF engine crashed', 'Crash'))
    pending.clear()
    worker = null
  }
  return worker
}

export function call<K extends keyof Handlers>(method: K, args: Args<K>, transfer: Transferable[] = []): Promise<Ret<K>> {
  const reqId = nextId++
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (v: never) => void, reject })
    getWorker().postMessage({ reqId, method, args }, transfer)
  })
}

export type { BlockInfo, DocInfo }
