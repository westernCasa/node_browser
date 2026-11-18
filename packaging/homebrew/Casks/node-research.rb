cask "node-research" do
  arch arm: "arm64", intel: "x64"

  version "0.12.0"
  sha256 arm:   "d8f16bdd4bdeaf55fd8730e20e34bf7cfc6eb67a6a7b052819608d0f543be316",
         intel: "cf6daba4d0db279562a737bd44e8748f67139c555928beafcb759a63a8048ea7"

  url "https://github.com/westernCasa/node_browser/releases/download/v#{version}/NODE-#{version}-mac-#{arch}.dmg",
      verified: "github.com/westernCasa/node_browser/"
  name "NODE Research Browser"
  desc "Research browser that maps what you read and shares it with others"
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
