# Android app signing

Release builds are signed with a **release keystore**. Debug builds use the debug keystore (already in the project).

## Current setup

- **Keystore:** `android/app/my-upload-key.keystore`
- **Alias:** `my-key-alias`
- **Config:** `android/keystore.properties` (gitignored — do not commit)

The `android/app/build.gradle` `release` signing config reads from `android/keystore.properties` automatically. If that file is missing, release builds fall back to the debug keystore.

## Restoring on a fresh clone

If `keystore.properties` is missing (e.g. after a fresh clone):

1. Copy the example:

   ```bash
   cp android/keystore.properties.example android/keystore.properties
   ```

2. Fill in your passwords:

   ```properties
   storeFile=my-upload-key.keystore
   storePassword=YOUR_STORE_PASSWORD
   keyAlias=my-key-alias
   keyPassword=YOUR_KEY_PASSWORD
   ```

3. Ensure `android/app/my-upload-key.keystore` is present (restore from your backup if needed).

## Creating a new keystore (if needed)

Only do this if you don't have the existing keystore. If you've already published, **you must use the same keystore** for all future updates.

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

Then fill in `android/keystore.properties` with the passwords you chose.

## Summary

| Item               | Location                              | Commit? |
| ------------------ | ------------------------------------- | ------- |
| Keystore file      | `android/app/my-upload-key.keystore`  | No      |
| Passwords / config | `android/keystore.properties`         | No      |
| Example config     | `android/keystore.properties.example` | Yes     |

> **Back up your keystore and passwords.** If you lose them you cannot publish updates to the same Play Store listing.

See [PLAY_STORE_RELEASE.md](./PLAY_STORE_RELEASE.md) for full release and upload steps.
