import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export function shouldRunMigrations(env) {
  return env.VERCEL_ENV !== 'preview'
}

function main() {
  if (!shouldRunMigrations(process.env)) {
    console.log('Skipping database migrations for Vercel preview deployment')
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const prismaCli = resolve(scriptDirectory, '../node_modules/prisma/build/index.js')
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.signal) {
    console.error(`Prisma migration process terminated by ${result.signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = result.status ?? 1
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) main()
