# import certificate and provisioning profile from secrets
# https://docs.github.com/en/actions/deployment/deploying-xcode-applications/installing-an-apple-certificate-on-macos-runners-for-xcode-development
# echo "certificatePath: {certificatePath}"
# echo "keychainPath: {keychainPath}"
# echo -n "$APPLE_CERTIFICATES" | base64 --decode --output {certificatePath}

# # create temporary keychain
# security create-keychain -p "$APPLE_CERTIFICATES_PASSWORD" {keychainPath}
# security set-keychain-settings -lut 21600 {keychainPath}
# security unlock-keychain -p "$APPLE_CERTIFICATES_PASSWORD" {keychainPath}

# # import certificate to keychain
# security import {certificatePath} -P "$APPLE_CERTIFICATES_PASSWORD" -A -t cert -f pkcs12 -k {keychainPath}
# security list-keychain -d user -s {keychainPath}

# # log
# security cms -D -i "{appPath}/Contents/embedded.provisionprofile"

# Sign individual components of the .app
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/Electron Framework.framework/Versions/A/Electron Framework"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/Electron Framework.framework/Libraries/libffmpeg.dylib"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/Electron Framework.framework"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/{appName} Helper.app/Contents/MacOS/{appName} Helper"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{frameworksPath}/{appName} Helper.app/"
codesign -s "{appKey}" -f --entitlements "{loginHelperPlist}" "{appPath}/Contents/Library/LoginItems/{appName} Login Helper.app/Contents/MacOS/{appName} Login Helper"
codesign -s "{appKey}" -f --entitlements "{loginHelperPlist}" "{appPath}/Contents/Library/LoginItems/{appName} Login Helper.app/"
codesign -s "{appKey}" -f --entitlements "{childPlist}" "{appPath}/Contents/MacOS/{appName}"
codesign -s "{appKey}" -f --entitlements "{parentPlist}" "{appPath}"

# Repackage it
productbuild --component "{appPath}" /Applications --sign "{installerKey}" "{resultPath}"
