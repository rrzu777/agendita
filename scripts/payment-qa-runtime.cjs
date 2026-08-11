/* eslint-disable @typescript-eslint/no-require-imports -- executable CommonJS support */

const { realpathSync } = require('node:fs')
const { dirname, isAbsolute, join, relative, sep } = require('node:path')

function trustedLocalFile(candidate, nodeModulesRoot) {
  const resolved = realpathSync(candidate)
  const child = relative(nodeModulesRoot, resolved)
  if (!child || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)) {
    throw new Error('Payment QA CLI resolved outside repository node_modules.')
  }
  return resolved
}

function paymentQaCommands(root = process.cwd()) {
  const repository = realpathSync(root)
  const nodeModules = realpathSync(join(repository, 'node_modules'))
  const vitestPackage = require.resolve('vitest/package.json', { paths: [repository] })
  const vitest = trustedLocalFile(join(dirname(vitestPackage), 'vitest.mjs'), nodeModules)
  const prisma = trustedLocalFile(require.resolve('prisma', { paths: [repository] }), nodeModules)
  const executable = realpathSync(process.execPath)
  return {
    vitest: { executable, cli: vitest },
    prisma: { executable, cli: prisma },
  }
}

module.exports = { paymentQaCommands }
