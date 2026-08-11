import http from 'node:http'
import https from 'node:https'

type MutableGlobal = { fetch?: unknown }
type MutableHttp = { request?: unknown; get?: unknown }

const deny = () => {
  throw new Error('PAYMENT_QA_OFFLINE blocks external HTTP(S) traffic')
}

export function installPaymentQaNetworkDeny(
  environment: NodeJS.ProcessEnv,
  targets: { global: MutableGlobal; http: MutableHttp; https: MutableHttp },
) {
  if (environment.PAYMENT_QA_OFFLINE !== '1') {
    throw new Error('Payment QA network guard requires PAYMENT_QA_OFFLINE=1')
  }
  targets.global.fetch = deny
  targets.http.request = deny
  targets.http.get = deny
  targets.https.request = deny
  targets.https.get = deny
}

if (process.env.PAYMENT_QA_OFFLINE === '1') {
  installPaymentQaNetworkDeny(process.env, {
    global: globalThis as MutableGlobal,
    http: http as unknown as MutableHttp,
    https: https as unknown as MutableHttp,
  })
}
