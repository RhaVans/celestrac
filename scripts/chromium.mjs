/**
 * Shared Chromium launcher for the check scripts.
 *
 * The browser is started as its own process and Playwright attaches over CDP.
 * Launching through Playwright directly proved unstable in a bare container:
 * the process exits between launch and the first page. Owning the process also
 * means its stderr is available when something does go wrong.
 */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

export const FLAGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
]

/** Headless shell first: it links against fewer system libraries than full Chrome. */
function resolveChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN
  const cache = join(homedir(), '.cache/ms-playwright')
  try {
    const shell = readdirSync(cache).find((entry) => entry.startsWith('chromium_headless_shell-'))
    if (shell) {
      const path = join(cache, shell, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
      if (existsSync(path)) return path
    }
  } catch {
    // fall through to Playwright's own resolution
  }
  return chromium.executablePath()
}

export async function startChromium(port = 9333) {
  const executable = resolveChromium()
  if (!existsSync(executable)) {
    throw new Error(`No Chromium at ${executable}. Run: npx playwright install chromium`)
  }
  const profile = mkdtempSync(join(tmpdir(), 'celestrac-check-'))
  const child = spawn(
    executable,
    [
      ...FLAGS,
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: false },
  )
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
    if (stderr.length > 4000) stderr = stderr.slice(-4000)
  })
  let exitCode = null
  child.on('exit', (code) => {
    exitCode = code
  })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`Chromium exited (${exitCode}): ${stderr.split('\n').slice(-4).join(' | ')}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        return { browser, child }
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Chromium did not expose CDP on ${port}. ${stderr.split('\n').slice(-4).join(' | ')}`)
}
