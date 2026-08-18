const LOCAL_STARTUP_STEPS = [
  {
    id: 'starting-local-server',
    label: 'Starting local server',
    description: 'Launching the private runtime',
  },
  {
    id: 'checking-compatibility',
    label: 'Checking compatibility',
    description: 'Confirming this build is ready',
  },
  {
    id: 'opening-workspace',
    label: 'Opening workspace',
    description: 'Loading your local workspace',
  },
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getActiveStepIndex(stage) {
  const index = LOCAL_STARTUP_STEPS.findIndex((step) => step.id === stage);
  return index >= 0 ? index : 0;
}

function getStepState(index, activeIndex) {
  if (index < activeIndex) return 'complete';
  if (index === activeIndex) return 'current';
  return 'pending';
}

export function buildLocalStartupHtml(productName, title, stage) {
  const activeIndex = getActiveStepIndex(stage);
  const activeStep = LOCAL_STARTUP_STEPS[activeIndex];
  const safeProductName = escapeHtml(productName || 'Application');
  const safeTitle = escapeHtml(title || productName || 'Local workspace');
  const steps = LOCAL_STARTUP_STEPS.map((step, index) => {
    const state = getStepState(index, activeIndex);
    const status = state === 'complete' ? 'Complete' : state === 'current' ? 'In progress' : 'Up next';
    const marker = state === 'complete' ? '✓' : String(index + 1);
    return `<li class="step ${state}"${state === 'current' ? ' aria-current="step"' : ''}>`
      + `<span class="step-marker" aria-hidden="true">${marker}</span>`
      + '<span class="step-copy">'
      + `<strong>${escapeHtml(step.label)}</strong>`
      + `<small>${escapeHtml(step.description)} · ${status}</small>`
      + '</span>'
      + '</li>';
  }).join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>Preparing ${safeTitle}</title>`,
    '<style>',
    ':root{color-scheme:light;--canvas:#f2f5f9;--card:#ffffff;--card-border:#dbe2ea;--text:#15202b;--muted:#5b6878;--quiet:#536273;--brand:#0a66d9;--brand-contrast:#ffffff;--brand-soft:#e8f1ff;--track:#e6ebf1;--success:#18794e;--success-soft:#e3f6ed}',
    '@media(prefers-color-scheme:dark){:root{color-scheme:dark;--canvas:#080c12;--card:#111823;--card-border:#273343;--text:#f5f8fc;--muted:#b4c0cf;--quiet:#8795a7;--brand:#6ea8ff;--brand-contrast:#0b1624;--brand-soft:#172e50;--track:#293646;--success:#66d7a2;--success-soft:#143628}}',
    'html,body{height:100%;margin:0}',
    'body{background:radial-gradient(circle at 50% -20%,rgba(68,137,232,.16),transparent 48%),var(--canvas);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.startup{min-height:100%;display:grid;place-items:center;padding:28px}',
    '.startup-card{width:min(100%,700px);padding:32px;border:1px solid var(--card-border);border-radius:24px;background:var(--card);box-shadow:0 24px 70px rgba(20,42,70,.14)}',
    '@media(prefers-color-scheme:dark){.startup-card{box-shadow:0 24px 70px rgba(0,0,0,.3)}}',
    '.brand{display:flex;align-items:center;gap:10px;margin-bottom:34px;font-weight:700;letter-spacing:-.01em}',
    '.brand-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--brand);color:var(--brand-contrast);box-shadow:0 7px 18px rgba(10,102,217,.25)}',
    '.brand-mark svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}',
    '.brand-name{display:flex;align-items:baseline;gap:7px;font-size:16px}',
    '.brand-name small{color:var(--quiet);font-size:12px;font-weight:600;letter-spacing:.02em}',
    '.eyebrow{margin:0 0 8px;color:var(--brand);font-size:11px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}',
    'h1{margin:0;font-size:clamp(24px,4vw,32px);letter-spacing:-.035em;line-height:1.12}',
    '.intro{max-width:520px;margin:12px 0 26px;color:var(--muted);font-size:15px}',
    '.stage-status{display:flex;align-items:center;gap:9px;margin:0 0 10px;font-size:13px;font-weight:650}',
    '.stage-dot{width:8px;height:8px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 5px var(--brand-soft);flex:0 0 auto}',
    '.progress-track{height:5px;margin-bottom:28px;overflow:hidden;border-radius:99px;background:var(--track)}',
    '.progress-fill{display:block;width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,var(--brand),transparent);animation:startup-progress 1.8s ease-in-out infinite}',
    '@keyframes startup-progress{0%{transform:translateX(-125%)}100%{transform:translateX(275%)}}',
    '.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}',
    '.step{min-width:0;display:flex;align-items:flex-start;gap:10px;padding:13px 12px;border:1px solid var(--card-border);border-radius:14px;color:var(--quiet)}',
    '.step.current{border-color:var(--brand);background:var(--brand-soft);color:var(--text)}',
    '.step.complete{color:var(--text)}',
    '.step-marker{display:grid;width:25px;height:25px;flex:0 0 auto;place-items:center;border:1px solid currentColor;border-radius:50%;font-size:11px;font-weight:750}',
    '.step.current .step-marker{border-color:var(--brand);background:var(--brand);color:var(--brand-contrast)}',
    '.step.complete .step-marker{border-color:var(--success);background:var(--success-soft);color:var(--success)}',
    '.step-copy{min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.step-copy strong{font-size:12px;line-height:1.25}',
    '.step-copy small{color:var(--quiet);font-size:11px;line-height:1.35}',
    '.step.current .step-copy small{color:var(--muted)}',
    '.footer-note{display:flex;align-items:center;gap:8px;margin:26px 0 0;color:var(--quiet);font-size:12px}',
    '.footer-note svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7}',
    '@media(max-width:640px){.startup{padding:16px}.startup-card{padding:24px 20px;border-radius:20px}.brand{margin-bottom:28px}.steps{grid-template-columns:1fr;gap:8px}.step{padding:11px 12px}.footer-note{margin-top:22px}}',
    '@media(prefers-reduced-motion:reduce){.progress-fill{width:44%;animation:none;transform:none}}',
    '</style>',
    '</head>',
    '<body>',
    '<main class="startup" aria-labelledby="startup-title">',
    '<section class="startup-card">',
    '<header class="brand">',
    '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M5 7.5h18M5 20.5h18M8.5 13.8l3.2 2.9-3.2 2.9M15.5 19.6h4"/></svg></span>',
    `<span class="brand-name">${safeProductName} <small>Desktop</small></span>`,
    '</header>',
    '<p class="eyebrow">Local workspace</p>',
    '<h1 id="startup-title">Getting your workspace ready</h1>',
    `<p class="intro">Opening <strong>${safeTitle}</strong> on this device. Your local workspace starts automatically and does not require a product sign-in.</p>`,
    `<p class="stage-status" role="status" aria-live="polite"><span class="stage-dot" aria-hidden="true"></span>${escapeHtml(activeStep.label)}</p>`,
    `<div class="progress-track" role="progressbar" aria-label="Workspace startup" aria-valuetext="${escapeHtml(activeStep.label)}" aria-busy="true"><span class="progress-fill" aria-hidden="true"></span></div>`,
    `<ol class="steps" aria-label="Workspace startup stages">${steps}</ol>`,
    '<footer class="footer-note"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.5-2.9 8.2-7 10-4.1-1.8-7-5.5-7-10V6l7-3Z"/><path d="m9.5 12 1.7 1.7 3.5-3.7"/></svg><span>Everything stays local on this device.</span></footer>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}

export { LOCAL_STARTUP_STEPS };
