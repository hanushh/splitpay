# Android Play Store Release (Local Build)

Build the app locally and upload the AAB to Google Play Console yourself. No third-party build services.

## Prerequisites

1. **Google Play Developer account**  
   Sign up at [Google Play Console](https://play.google.com/apps/publish/signup/) (one-time $25 fee).

2. **Create the app in Play Console**  
   In [Google Play Console](https://play.google.com/apps/publish/), click **Create app** and complete the basic listing:
   - App name: **PaySplit**
   - Package name: `com.hanushh.paysplit`

3. **Android build environment**  
   JDK 17+, Android SDK, and `ANDROID_HOME` set. You can use Android Studio or the command-line tools.

4. **Android project**  
   If there is no `android` folder (e.g. fresh clone; it may be gitignored), generate it first:
   ```bash
   npx expo prebuild --platform android
   ```

## 1. Release keystore

For a focused guide on creating the keystore and `keystore.properties`, see **[App signing](APP_SIGNING.md)**.

The keystore is already set up:
- Keystore: `android/app/my-upload-key.keystore`
- Config: `android/keystore.properties`

If `keystore.properties` is missing (e.g. fresh clone), copy the example and fill in your passwords:

```bash
cp android/keystore.properties.example android/keystore.properties
```

```properties
storeFile=my-upload-key.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=my-key-alias
keyPassword=YOUR_KEY_PASSWORD
```

## 2. Set version for each release

Before each release, bump versions so Play Store accepts the upload:

- **Version name** (user-facing, e.g. `1.0.0`): set in **`app.json`** → `expo.version` and in **`android/app/build.gradle`** → `defaultConfig.versionName`.
- **Version code** (integer, must increase every upload): set in **`app.json`** → `expo.android.versionCode` and in **`android/app/build.gradle`** → `defaultConfig.versionCode`.

Example: for the next release use `versionName "1.0.1"` and `versionCode 2`. Keep both files in sync.

## 3. Build the AAB locally

```bash
npm run build:android
```

Or manually:

```bash
cd android && NODE_ENV=production ./gradlew bundleRelease
```

**Where to find the AAB**

```
android/app/build/outputs/bundle/release/app-release.aab
```

Open in Finder:

```bash
open android/app/build/outputs/bundle/release/
```

If the path doesn't exist, the build hasn't run yet. Use `find android -name "*.aab"` to locate it.

## 4. Upload to Play Console

1. Open [Google Play Console](https://play.google.com/apps/publish/) → your app (**PaySplit**).
2. Go to **Testing → Internal testing** → **Create new release**.
3. Upload `app-release.aab`.
4. Add release notes → **Save** → **Review release** → **Start rollout**.

Once internal testing looks good, promote to **Production** from the same console.

## Summary

| Step              | Action |
|-------------------|--------|
| One-time          | Keystore and `keystore.properties` already set up (see App signing). |
| Before each release | Bump `versionCode` and `versionName` in `app.json` and `android/app/build.gradle`. |
| Build             | `npm run build:android` → AAB at `android/app/build/outputs/bundle/release/`. |
| Publish           | Upload AAB in Play Console and start the release. |

## Troubleshooting

- **AAB path doesn't exist**  
  Run `npm run build:android` first. If the `android` folder is missing, run `npx expo prebuild --platform android` first. Use `find android -name "*.aab"` to locate the file.

- **"Duplicate version code"**  
  Each upload must have a higher `versionCode`. Increment it in both `app.json` and `android/app/build.gradle`.

- **Signing errors**  
  Check that `android/keystore.properties` exists, passwords are correct, and `storeFile=my-upload-key.keystore` (relative to `android/app/`).

- **Build fails (env / Metro)**  
  Ensure `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set in `.env` when running the build.
