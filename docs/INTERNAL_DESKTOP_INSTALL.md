# CloudCLI Internal Desktop Build

This release is built with repository-managed self-signed certificates. The
artifacts and updater metadata are produced by the same cross-platform release
pipeline as production builds, but Apple and Microsoft do not vouch for the
signing identities.

Only install these certificates and applications when the release comes from
the canonical `MHMK2002/claudecodeui` GitHub repository.

## Windows first install

1. Download `cloudcli-internal-windows.cer` from the same GitHub Release.
2. Open PowerShell as the intended user in the download directory.
3. Trust the certificate for that user:

   ```powershell
   Import-Certificate -FilePath .\cloudcli-internal-windows.cer -CertStoreLocation Cert:\CurrentUser\Root
   Import-Certificate -FilePath .\cloudcli-internal-windows.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
   ```

4. Install the versioned `.exe` from the Release.

## macOS first install

1. Download `cloudcli-internal-macos.cer` from the same GitHub Release.
2. Import it into the login keychain with Keychain Access and set its Trust
   policy to **Always Trust**.
3. Mount the versioned `.dmg` and copy CloudCLI to Applications.
4. Because this internal build is not Apple-notarized, remove quarantine once:

   ```bash
   xattr -dr com.apple.quarantine /Applications/CloudCLI.app
   ```

5. Open CloudCLI from Applications.

## Linux first install

Make the AppImage executable and run it:

```bash
chmod +x cloudcli-desktop-*-linux-*.AppImage
./cloudcli-desktop-*-linux-*.AppImage
```

## Automatic updates

After the first trusted installation, later internal releases signed by these
same certificates can be downloaded through CloudCLI's in-app updater. Do not
delete or replace the repository signing secrets between releases.
