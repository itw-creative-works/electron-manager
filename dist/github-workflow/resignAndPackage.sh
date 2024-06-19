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
