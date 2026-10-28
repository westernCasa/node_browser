cask "node-research" do
  arch arm: "arm64", intel: "x64"

  version "0.9.9"
  sha256 arm:   "4b3726a82a2e8e5102e4c3f3eb537b7d7412ea53fe089b5a040befb985810078",
         intel: "a310d0323a3bdad3b8e0aeaf56a55e0eef0866e42e210258c161beee41e5a480"

  url "https://github.com/westernCasa/node_browser/releases/download/v#{version}/NODE-#{version}-mac-#{arch}.dmg",
      verified: "github.com/westernCasa/node_browser/"
  name "NODE Research Browser"
  desc "Research browser that suggests what to read next from the page you are on"
  homepage "https://noderesearch.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "NODE.app"

  zap trash: [
    "~/Library/Application Support/NODE",
    "~/Library/Caches/app.scout.browser",
    "~/Library/Caches/app.scout.browser.ShipIt",
    "~/Library/Logs/NODE",
    "~/Library/Preferences/app.scout.browser.plist",
    "~/Library/Saved Application State/app.scout.browser.savedState",
  ]
end
