const dns = require('dns').promises
const fs = require('fs')
const path = require('path')

function loadLocalEnvIfNeeded() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return
  }

  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    return
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) {
      continue
    }

    const [key, ...valueParts] = line.split('=')
    const trimmedKey = key.trim()
    if (!process.env[trimmedKey]) {
      process.env[trimmedKey] = valueParts.join('=').trim()
    }
  }
}

async function main() {
  loadLocalEnvIfNeeded()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid URL')
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must use https')
  }

  if (!parsedUrl.hostname.endsWith('.supabase.co')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must point to a Supabase project hostname')
  }

  try {
    await dns.resolve(parsedUrl.hostname)
  } catch (error) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL hostname does not resolve: ${parsedUrl.hostname}. ` +
        'Check that the Supabase project exists and the repository secret is current.'
    )
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
