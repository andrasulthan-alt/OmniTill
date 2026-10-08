# OmniTill for Android

A small native shell around the OmniTill website. The website is bundled inside the APK and served from a private
https address, so the app opens instantly, works offline, and does not need Chrome. Sales still go straight to your own
Supabase project. The app has only the internet permission, no analytics and no ads, and Android backup is switched off.

## Get the APK

- **GitHub Releases:** download `OmniTill-x.y.z.apk` from the latest release.
- **Obtainium:** add this repository's URL. It follows new releases by itself.
- Check the file with `SHA256SUMS.txt` from the same release.

## Build it yourself in GitHub (one-time setup)

An APK must be signed with one key, and **the same key must be used for every update**, or Android will refuse to update the
app. You create that key once and keep it forever.

1. Create the key on your computer (needs Java):

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore omnitill-release.p12 \
     -alias omnitill -keyalg RSA -keysize 4096 -validity 36500 \
     -dname "CN=OmniTill, O=Your name"
   ```

2. Turn it into text so GitHub can store it:

   ```bash
   base64 -w0 omnitill-release.p12      # Linux
   base64 -i omnitill-release.p12       # macOS
   ```

3. In the repository open **Settings, Secrets and variables, Actions, New repository secret** and add four secrets:

   | Secret | Value |
   | --- | --- |
   | `KEYSTORE` | the long base64 text from step 2 |
   | `KEYSTORE_PASSWORD` | the password you typed in step 1 |
   | `SIGNING_KEY_ALIAS` | `omnitill` |
   | `SIGNING_KEY_PASSWORD` | the key password (the same as the store password for PKCS12) |

4. **Back up `omnitill-release.p12` and its password** somewhere safe and offline (a USB stick). Never commit it to the repository
   and never paste it in a chat. If you lose it, users must uninstall before they can install a build signed with a new key.

5. Publish a release: push a tag such as `v1.0.0`, or run **Actions, Android APK, Run workflow**. The workflow builds,
   signs, and attaches the APK to the release.

Without the secrets the workflow still builds an APK, signed with a throwaway debug key. It installs fine for testing but
cannot be updated by a properly signed build.

## Build locally

```bash
cd android
./gradlew assembleRelease     # needs JDK 17 and the Android SDK
```

## What the shell does

- Serves the bundled website from `https://appassets.androidplatform.net/` (a secure origin, so the PIN lock's cryptography works).
- Opens any other link in your browser instead of inside the till.
- Blocks file access, cleartext traffic and mixed content.
- Hides the sales screen in the recent-apps list (Android 13 and later).
- Adds two things a WebView lacks: saving a CSV export to Downloads and printing a receipt.
