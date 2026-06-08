import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, type ProviderType } from '@/lib/llm/providers'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = request.headers.get('X-LLM-Api-Key') ?? ''

  if (!apiKey) {
    return NextResponse.json({ valid: false, error: 'Missing X-LLM-Api-Key header' }, { status: 400 })
  }

  let body: { provider?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ valid: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { provider } = body
  if (!provider || !['nvidia', 'gemini', 'openai'].includes(provider)) {
    return NextResponse.json({ valid: false, error: 'Invalid provider' }, { status: 400 })
  }

  const valid = await validateApiKey(provider as ProviderType, apiKey)
  return NextResponse.json({ valid })
}
