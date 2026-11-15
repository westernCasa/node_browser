# Releasing NODE on the App Store and Google Play

Steps in order. Commands run on the Mac in `~/Projects/scout-mobile/mobile` (the phone-only copy of the repo). The research behind this plan is summed up in the project doc `29-mobile-release.md`.

## Before the first build (once)

1. **Google Play account:** play.google.com/console, personal account, $25, ID check and device check in the Play Console app.
2. **Fill in the blanks** in this folder and in `app.json`:
   - `app.json` → `expo.extra.reportEmail`: where AI reports go. The ⚑ Report button opens an email to this address.
   - `privacy-policy.md` and `review-notes.md`: `[CONTACT EMAIL]` and `[DATE OF FIRST RELEASE]`.
3. **Publish the privacy policy** at a public web address, for example with GitHub Pages. Both stores ask for the link.
4. **Install the build tools:**
   ```
   npm install -g eas-cli
   eas login            # your Expo account (svenm3)
   eas init             # links this app to an Expo project; writes the project id into app.json
   ```
   If `eas login` fails like `expo login` did, set `EXPO_TOKEN` from expo.dev → Access tokens first (see the README).

## Development build (replaces Expo Go)

Expo Go can't be used for release testing. A development build is your own copy of NODE with the real native settings.

```
eas device:create                                   # register your iPhone (opens a link to install a profile)
eas build -p ios --profile development              # about 15–30 min on the free plan
eas build -p android --profile development
npx expo start --dev-client                         # then open NODE (dev) on the phone
```

Things to test that Expo Go didn't cover: plain http sites, Capture thumbnails, opening and sharing files, keys after restarting the app, and the iPad layout.

## Production builds and the stores

```
eas build -p all --profile production
```

**iPhone and iPad:**
1. App Store Connect → Apps → New App. Platform iOS, name NODE Research Browser, bundle ID `app.node.browser`, SKU `node-browser`.
2. `eas submit -p ios` uploads the build. TestFlight internal testing works right away.
3. Fill in the forms with the answers in `disclosures.md`: App Privacy, age rating (16+), and App Review notes from `review-notes.md`.
4. TestFlight → External testing → add testers. The first build goes through Beta App Review, about a day.

**Android:**
1. Play Console → Create app: NODE Research Browser, App, Free.
2. Upload the first `.aab` **by hand**: Testing → Internal testing → Create release. Download the .aab from the EAS build page. Google needs this first upload before EAS Submit can work.
3. App content: privacy policy URL, ads (No), app access, content rating, target audience 18+, Data safety and generative AI. Answers are in `disclosures.md`.
4. Testing → Closed testing → create a track and add testers. Use a Google Group with **at least 12, ideally 15–20 people**. They must stay opted in for **14 days in a row**.
5. After day 14: Dashboard → Apply for production. Google usually answers within 7 days.
6. For later builds, upload with `eas submit -p android` (needs a Google service account key; EAS walks you through it).

## Release

- iOS: submit the version for review with manual release. Release when Android is approved, if you want both on the same day.
- Android: production with a staged rollout, for example 20% first.

## After release

- Over-the-air updates (`eas update`) are for bug fixes only. New features go through review as a new build.
- Check in Play Console that the app shows as registered for Android developer verification.
- Apply to Apple for the default browser setting (`com.apple.developer.web-browser`). It needs the App Store link.
- Before August 2027: move to Android target SDK 37. That adds the local network permission and the large-screen rules.
