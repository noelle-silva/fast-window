const root = document.createElement('main')
root.className = 'demo-shell'
root.innerHTML = `
  <section class="hero">
    <div class="eyebrow">Fast Window v4</div>
    <h1>Contract Demo</h1>
    <p>
      A minimal trusted local app package with a UI, a system backend,
      shared schema, and package assets.
    </p>
  </section>

  <section class="actions" aria-label="Demo actions">
    <button id="toastButton" type="button">Show Host Toast</button>
    <button id="pingButton" type="button">Call demo.ping</button>
  </section>

  <section class="status-card" aria-live="polite">
    <div class="status-label">Backend result</div>
    <pre id="resultBox">Click "Call demo.ping" to talk to the backend.</pre>
  </section>
`

const style = document.createElement('style')
style.textContent = `
  :root {
    color: #e8f0ff;
    background: #07111f;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top left, rgba(68, 140, 255, 0.35), transparent 34rem),
      linear-gradient(135deg, #07111f 0%, #111827 54%, #1a1232 100%);
  }

  .demo-shell {
    box-sizing: border-box;
    display: grid;
    gap: 1rem;
    max-width: 760px;
    min-height: 100vh;
    margin: 0 auto;
    padding: clamp(1.5rem, 5vw, 4rem);
    align-content: center;
  }

  .hero,
  .status-card {
    border: 1px solid rgba(191, 219, 254, 0.24);
    border-radius: 24px;
    background: rgba(15, 23, 42, 0.72);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(18px);
  }

  .hero {
    padding: clamp(1.5rem, 5vw, 3rem);
  }

  .eyebrow {
    margin-bottom: 0.75rem;
    color: #93c5fd;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.25rem, 8vw, 5rem);
    line-height: 0.95;
    letter-spacing: -0.07em;
  }

  p {
    max-width: 34rem;
    margin: 1rem 0 0;
    color: #cbd5e1;
    font-size: 1rem;
    line-height: 1.7;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  button {
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    padding: 0.8rem 1.15rem;
    color: #07111f;
    background: #bfdbfe;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }

  button:hover {
    background: #dbeafe;
  }

  button:focus-visible {
    outline: 3px solid #facc15;
    outline-offset: 3px;
  }

  .status-card {
    padding: 1rem;
  }

  .status-label {
    margin-bottom: 0.5rem;
    color: #93c5fd;
    font-size: 0.85rem;
    font-weight: 800;
  }

  pre {
    overflow: auto;
    margin: 0;
    padding: 1rem;
    border-radius: 16px;
    color: #d1fae5;
    background: rgba(2, 6, 23, 0.72);
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  @media (max-width: 560px) {
    .actions,
    button {
      width: 100%;
    }
  }
`

document.head.appendChild(style)
document.body.appendChild(root)

const resultBox = document.getElementById('resultBox')

function writeResult(value) {
  resultBox.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

document.getElementById('toastButton').addEventListener('click', async () => {
  await window.fastWindow.host.toast('Hello from the v4 demo UI')
})

document.getElementById('pingButton').addEventListener('click', async () => {
  writeResult('Waiting for backend...')
  try {
    const result = await window.fastWindow.background.invoke('demo.ping', {
      message: 'hello from UI',
      sentAt: new Date().toISOString(),
    })
    writeResult(result)
  } catch (err) {
    writeResult({ error: String(err && err.message ? err.message : err) })
  }
})
