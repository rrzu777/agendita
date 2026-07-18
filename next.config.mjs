import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
  experimental: {
    // Las 12 primitivas de ui/ importan del barrel monolítico 'radix-ui', que
    // reexporta ~35 sub-paquetes; sin esto, Button (usado en casi toda página)
    // arrastra todos al grafo. No está en la lista optimizada por default de Next
    // (lucide-react y date-fns sí lo están, por eso no van acá).
    optimizePackageImports: ['radix-ui'],
  },
};

export default nextConfig;
