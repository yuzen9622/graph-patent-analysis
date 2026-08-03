import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: '未登入。' }, { status: 401 })
  return NextResponse.json({
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  })
}
