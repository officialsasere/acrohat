# Packaging & distribution (all free)

## GitHub Releases
Tag a version (`git tag v0.1.0 && git push --tags`). `.github/workflows/release.yml` builds and attaches installers. Review the draft release, then publish it.

## GitHub Pages (website + web app)
Settings → Pages → Source: **GitHub Actions**. The `Website` workflow deploys `site/` and the web build.

## Homebrew (macOS)
Create a repo named `homebrew-acrohat` with `Casks/acrohat.rb`:
```ruby
cask "acrohat" do
  version "0.1.0"
  sha256 "<sha256 of the .dmg>"
  url "https://github.com/OWNER/acrohat/releases/download/v#{version}/Acrohat_#{version}_aarch64.dmg"
  name "Acrohat"
  desc "Free, open-source PDF reader and editor"
  homepage "https://OWNER.github.io/acrohat/"
  app "Acrohat.app"
end
```
Users: `brew tap OWNER/acrohat && brew install --cask acrohat`. Note Homebrew is tightening its rules for unsigned casks; a personal tap is not affected by the main repo's policy.

## winget (Windows)
Submit a manifest PR to `microsoft/winget-pkgs` (`wingetcreate new <msi url>`). Free; requires a stable installer URL.

## Flathub (Linux)
Submit a Flatpak manifest to `flathub/flathub`. Free; reviewers require an app-id you control (e.g. `io.github.OWNER.Acrohat`).

## Code signing (optional, later)
- **Windows**: apply to [SignPath Foundation](https://signpath.org/) for free signing of open-source projects.
- **macOS**: needs a paid Apple Developer account for notarization; until then the ad-hoc signature + right-click-Open flow applies.
- **Auto-update**: Tauri's updater uses a free self-generated key (`npx tauri signer generate`); add `tauri-plugin-updater` and publish `latest.json` with each release.
