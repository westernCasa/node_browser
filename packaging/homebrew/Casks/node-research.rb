cask "node-research" do
  arch arm: "arm64", intel: "x64"

  version "0.11.0"
  sha256 arm:   "21629b2903111ba092c43cc0c94c316ba7886e90026dc164c5ad2e89ce791f63",
         intel: "f30db29842d5bac91bd402966d25ed3e0db3e4b151a7b1d6c5a312778a212bae"

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
