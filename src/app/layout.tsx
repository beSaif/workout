import type { Metadata, Viewport } from "next"
import "@fontsource-variable/inter"
import "./globals.css"
import SwRegistrar from "@/components/SwRegistrar"
import MiniPlayerBar from "@/components/MiniPlayerBar"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available: people who need larger text must be able to get it.
  themeColor: "#1e3a5f",
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: "Workout",
  description: "Block periodization for your one main lift.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Workout",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light" />
        <script dangerouslySetInnerHTML={{ __html: `try{var p=screen.orientation.lock('portrait');if(p&&p.catch)p.catch(function(){})}catch(_){}` }} />
        {/*
          Chrome fires beforeinstallprompt once, often before React has hydrated, and the
          event is only usable if it was preventDefault()ed. Stash it here so the install
          sheet can fire the real system dialog whenever it opens, however late that is.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.__installPrompt=null;" +
              "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;dispatchEvent(new Event('installpromptchange'))});" +
              "addEventListener('appinstalled',function(){window.__installPrompt=null;dispatchEvent(new Event('installpromptchange'))});",
          }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <SwRegistrar />
        {children}
        <MiniPlayerBar />
      </body>
    </html>
  )
}
