# Packaging & distribution (all free)

## GitHub Releases (one workflow per app)
Each app has its own workflow and its own tags, so releasing one never touches the others:

| App | Workflow (Actions tab) | Tag to push | Rolling release the website links to |
|---|---|---|---|
| Kwiiva Paper | **Release Kwiiva Paper** | `paper-v0.1.0` | `paper-latest` |
| Kwiiva Write | **Release Kwiiva Write** | `write-v0.1.0` | `write-latest` |
| Kwiiva Grid | **Release Kwiiva Grid** | `grid-v0.1.0` | `grid-latest` |
| Kwiiva Present | **Release Kwiiva Present** | `present-v0.1.0` | `present-latest` |

Run the workflow from the Actions tab ("Run workflow"), or tag a version (`git tag present-v0.1.0 && git push --tags`). All four call the shared `desktop-release.yml`, which builds Windows, macOS (Apple silicon and Intel) and Linux installers and publishes two releases: `<app>-v<version>` (kept) and `<app>-latest` (replaced each time, with fixed file names such as `KwiivaPresent-Windows-Setup.exe`).

Run an app's workflow only when that app has changed. Adding a new app needs its own workflow once; the others do not need to be run again. In Settings → Actions → General, set workflow permissions to **Read and write**.

## Netlify (website + web app)
Import the repository in Netlify. `netlify.toml` configures everything, including the counter function in `netlify/functions` (free tier; it uses Netlify Blobs). If your site is not `https://kwiiva.netlify.app`, change `STATS_ORIGIN` in `shared/usage.ts` (the desktop apps use it) and the host in the apps' `connect-src` content security policy in the two `tauri.conf.json` files. The Kwiiva home page is `/`, the Kwiiva Paper page is `/paper/` and the editor is `/paper/app/`. Add a custom domain under Domain management if you want one (a free `*.netlify.app` name works out of the box).

## Homebrew (macOS)
Create a repo named `homebrew-kwiiva` with `Casks/kwiiva-paper.rb`:
```ruby
cask "kwiiva-paper" do
  version "0.1.0"
  sha256 "<sha256 of the .dmg>"
  url "https://github.com/officialsasere/kwiiva/releases/download/paper-v#{version}/Kwiiva.Paper_#{version}_aarch64.dmg"
  name "Kwiiva Paper"
  desc "Free, open-source PDF reader and editor"
  homepage "https://YOUR-SITE.netlify.app/"
  app "Kwiiva Paper.app"
end
```
Users: `brew tap officialsasere/kwiiva && brew install --cask kwiiva-paper`. Note Homebrew is tightening its rules for unsigned casks; a personal tap is not affected by the main repo's policy.

## winget (Windows)
Submit a manifest PR to `microsoft/winget-pkgs` (`wingetcreate new <msi url>`). Free; requires a stable installer URL.

## Flathub (Linux)
Submit a Flatpak manifest to `flathub/flathub`. Free; reviewers require an app-id you control (e.g. `io.github.officialsasere.KwiivaPaper`).

## Code signing (optional, later)
- **Windows**: apply to [SignPath Foundation](https://signpath.org/) for free signing of open-source projects.
- **macOS**: needs a paid Apple Developer account for notarization; until then the ad-hoc signature + right-click-Open flow applies.
- **Auto-update**: Tauri's updater uses a free self-generated key (`npx tauri signer generate`); add `tauri-plugin-updater` and publish `latest.json` with each release.
