// Signs release builds with Finlyt's own key instead of React Native's debug key (which is the
// same for every project, so anyone could sign an "update" to a debug-signed APK).
//
// The key lives outside the repo. `~/.finlyt/keystore.properties` (or the file named by
// FINLYT_KEYSTORE_PROPERTIES) holds: enabled, storeFile, storePassword, keyAlias, keyPassword.
// Only when that file exists and says `enabled=true` is the release key used; otherwise builds
// are signed with the debug key as before. Switching keys is a one-way step for people who have
// the app: Android won't install the new build over the old one, and Google sign-in needs an
// Android OAuth client with the new key's SHA-1 first. See handoff.md.
const { withAppBuildGradle } = require("expo/config-plugins");

const LOAD = `
// Finlyt's release key, if it's set up on this machine (plugins/with-release-signing.js).
def finlytKeyFile = new File(System.getenv("FINLYT_KEYSTORE_PROPERTIES") ?: "\${System.getProperty('user.home')}/.finlyt/keystore.properties")
def finlytKey = new Properties()
if (finlytKeyFile.exists()) {
    finlytKeyFile.withInputStream { finlytKey.load(it) }
}
def finlytUseReleaseKey = finlytKey.getProperty("enabled") == "true"
`;

const CONFIG = `
        release {
            if (finlytUseReleaseKey) {
                storeFile file(finlytKey.getProperty("storeFile"))
                storePassword finlytKey.getProperty("storePassword")
                keyAlias finlytKey.getProperty("keyAlias")
                keyPassword finlytKey.getProperty("keyPassword")
            }
        }`;

/** Exported for a check without a prebuild: the build.gradle text in, the changed text out. */
function addReleaseSigning(gradle) {
  if (gradle.includes("finlytUseReleaseKey")) return gradle;
  const android = gradle.indexOf("\nandroid {");
  const configs = /signingConfigs \{\n(\s*)debug \{[\s\S]*?\n\1\}/.exec(gradle);
  const release = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/.exec(gradle);
  if (android < 0 || !configs || !release) {
    throw new Error("with-release-signing: android/app/build.gradle doesn't look like the template any more");
  }
  let out = gradle.replace(
    release[0],
    `${release[1]}signingConfig finlytUseReleaseKey ? signingConfigs.release : signingConfigs.debug`,
  );
  out = out.replace(configs[0], `${configs[0]}${CONFIG}`);
  return out.replace("\nandroid {", `${LOAD}\nandroid {`);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("with-release-signing: expected a Groovy build.gradle");
    }
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
};
module.exports.addReleaseSigning = addReleaseSigning;
