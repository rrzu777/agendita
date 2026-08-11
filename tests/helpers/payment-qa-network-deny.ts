import http from 'node:http'
import https from 'node:https'

const deny = () => {
  throw new Error('PAYMENT_QA_OFFLINE blocks external HTTP(S) traffic')
}

if (process.env.PAYMENT_QA_OFFLINE !== '1') {
  throw new Error('Payment QA network guard requires PAYMENT_QA_OFFLINE=1')
}

globalThis.fetch = deny as typeof fetch
http.request = deny as typeof http.request
http.get = deny as typeof http.get
https.request = deny as typeof https.request
https.get = deny as typeof https.get
