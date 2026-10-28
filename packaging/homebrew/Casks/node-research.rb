cask "node-research" do
  arch arm: "arm64", intel: "x64"

  version "0.9.8"
  sha256 arm:   "ac71173ab8f53c0b6f36e9f40976c39d00a429e3d8ec7ff8ca6827f896aa0e71",
         intel: "dbddb8e686d742b4a2704d626cff58d076652ae97c4b124dbfa4d3b28d2e36ed"

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
