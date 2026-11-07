// Adds a launch-screen style per Finlyt theme (Theme.App.SplashScreen.Light / .Dark / .Ink),
// each only changing the background, so the app can pick the one matching the user's theme
// (modules/splash-theme). The base style still follows the phone's light/dark setting.
const { AndroidConfig, withAndroidColors, withAndroidStyles } = require("expo/config-plugins");

const THEMES = { Light: "#FAFAF9", Dark: "#000000", Ink: "#0B1033" };

module.exports = function withSplashThemes(config) {
  config = withAndroidColors(config, (c) => {
    for (const [name, value] of Object.entries(THEMES)) {
      c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: `splash_${name.toLowerCase()}`, value });
    }
    return c;
  });
  config = withAndroidStyles(config, (c) => {
    for (const name of Object.keys(THEMES)) {
      c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
        add: true,
        parent: { name: `Theme.App.SplashScreen.${name}`, parent: "Theme.App.SplashScreen" },
        name: "windowSplashScreenBackground",
        value: `@color/splash_${name.toLowerCase()}`,
      });
    }
    return c;
  });
  return config;
};
