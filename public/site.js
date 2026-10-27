// Shared by every page of the Kwiiva website: makes the download buttons of each product work and shows the public counters.
// Installers live in GitHub Releases; the website itself is hosted on Netlify.
//
// To add a product: add it to PRODUCTS (and give its release workflow a rolling "<id>-latest" release), then put
// <div data-product="<id>"> on a page. Elements inside it: [data-role="main"] (the one-click button), [data-role="hint"],
// [data-role="status"], [data-os="win|mac|linux"] cards and a[data-file="<installer name>"] links.
(function () {
  const OWNER = 'officialsasere', REPO = 'kwiiva'
  const repoUrl = `https://github.com/${OWNER}/${REPO}`
  const PRODUCTS = {
    paper: {
      name: 'Kwiiva Paper',
      tag: 'paper-latest', // a release whose files are replaced on every new version, so these links never go stale
      web: '/paper/app/',
      main: { win: 'KwiivaPaper-Windows-Setup.exe', linux: 'KwiivaPaper-Linux.AppImage', macArm: 'KwiivaPaper-macOS-AppleSilicon.dmg', macIntel: 'KwiivaPaper-macOS-Intel.dmg' },
    },
    write: {
      name: 'Kwiiva Write',
      tag: 'write-latest',
      web: '/write/app/',
      main: { win: 'KwiivaWrite-Windows-Setup.exe', linux: 'KwiivaWrite-Linux.AppImage', macArm: 'KwiivaWrite-macOS-AppleSilicon.dmg', macIntel: 'KwiivaWrite-macOS-Intel.dmg' },
    },
  }

  document.querySelectorAll('a[href^="REPO_URL"]').forEach((a) => (a.href = a.getAttribute('href').replace('REPO_URL', repoUrl)))
  document.querySelectorAll('[data-repo-link]').forEach((a) => (a.href = repoUrl))

  const ua = navigator.userAgent, plat = navigator.platform || ''
  const os = /Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : /Mac/i.test(plat) ? 'mac' : /Win/i.test(plat) ? 'win' : /Linux|X11/i.test(plat + ua) ? 'linux' : 'other'

  async function macFile(p) {
    // Chromium can tell us the chip; Safari/Firefox can't, and almost every Mac sold since 2020 is Apple silicon.
    try {
      const h = await navigator.userAgentData?.getHighEntropyValues(['architecture'])
      if (h && h.architecture === 'x86') return p.main.macIntel
    } catch {}
    return p.main.macArm
  }

  async function wire(root) {
    const p = PRODUCTS[root.dataset.product]
    if (!p) return
    // Downloads go through /api/download so they can be counted, then on to GitHub (see netlify/functions/stats.mts).
    const direct = (file) => `/api/download/${root.dataset.product}/${file}`
    const q = (role) => root.querySelector(`[data-role="${role}"]`)
    const main = q('main'), hint = q('hint'), status = q('status')
    const card = (name) => root.querySelector(`[data-os="${name}"]`)
    root.querySelectorAll('a[data-file]').forEach((a) => { a.href = direct(a.dataset.file); a.setAttribute('download', '') })
    const set = (file, label) => { if (main) { main.href = direct(file); main.setAttribute('download', ''); main.textContent = label } }

    if (os === 'mac') {
      const f = await macFile(p)
      set(f, 'Download for macOS')
      if (hint) hint.innerHTML = f === p.main.macIntel ? 'Intel Mac detected' : 'Apple silicon. <a href="' + (card('mac') ? '#downloads' : p.web.replace('app/', '') + '#downloads') + '">Intel Mac?</a>'
      card('mac')?.classList.add('you')
    } else if (os === 'win' || os === 'linux') {
      const label = os === 'win' ? 'Windows' : 'Linux'
      set(p.main[os], 'Download for ' + label)
      if (hint) hint.textContent = `Detected: ${label}. Other systems on the product page.`
      card(os)?.classList.add('you')
    } else if (main) {
      main.href = p.web; main.textContent = 'Open in browser'
      if (hint) hint.textContent = os === 'mobile' ? 'On a phone? Use the browser version.' : 'Windows · macOS · Linux'
    }

    // If no release has been published yet, say so politely instead of sending people to a 404.
    try {
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${p.tag}`)
      if (!r.ok) throw new Error('no release')
      const rel = await r.json()
      if (status) status.textContent = `Latest: ${rel.name || p.name}. Free, no account.`
    } catch {
      root.querySelectorAll('.dl-card').forEach((c) => c.classList.add('soon'))
      root.querySelectorAll('a[data-file], [data-role="main"]').forEach((a) => { a.href = p.web; a.removeAttribute('download') })
      if (main) main.textContent = 'Open in browser'
      root.querySelectorAll('.actions a:not([data-role="main"])').forEach((a) => (a.hidden = true)) // would duplicate the button above
      if (hint) hint.textContent = 'Installers are being prepared. The browser version works right now.'
      if (status) status.innerHTML = `Installers are being prepared. <a href="${p.web}">Use ${p.name} in your browser</a> in the meantime.`
    }
  }

  document.querySelectorAll('[data-product]').forEach(wire)

  // Public totals: downloads from this site and anonymous app launches (see Privacy in the apps).
  const statBoxes = document.querySelectorAll('[data-stats]')
  if (statBoxes.length) {
    fetch('/api/stats').then((r) => (r.ok ? r.json() : Promise.reject())).then((data) => {
      const sum = (k) => Object.values(data.products).reduce((n, p) => n + p[k], 0)
      statBoxes.forEach((box) => {
        const which = box.dataset.stats
        const v = (k) => (which === 'all' ? sum(k) : data.products[which]?.[k] ?? 0)
        box.querySelectorAll('[data-stat]').forEach((el) => { el.textContent = v(el.dataset.stat).toLocaleString() })
        box.hidden = false
      })
    }).catch(() => statBoxes.forEach((b) => (b.hidden = true)))
  }
})()
