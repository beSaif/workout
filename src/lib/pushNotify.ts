import "server-only"
import webpush from "web-push"
import { store } from "./server/db"
import { pushSubKey } from "./userKeys"

interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

function getVapidConfigured(): boolean {
  const email = process.env.VAPID_EMAIL
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!email || !pub || !priv) return false
  const subject = email.startsWith("mailto:") ? email : `mailto:${email}`
  webpush.setVapidDetails(subject, pub, priv)
  return true
}

export async function sendPushToUser(email: string, payload: PushPayload): Promise<void> {
  if (!getVapidConfigured()) return
  const sub = await store.get<webpush.PushSubscription>(pushSubKey(email))
  if (!sub) return
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload))
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode === 410) {
      await store.del(pushSubKey(email))
    }
  }
}

