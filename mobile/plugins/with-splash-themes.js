// Adds a launch-screen style per Finlyt theme (Theme.App.SplashScreen.Light / .Dark / .Ink), so the
// app can pick the one matching the user's theme (modules/splash-theme). Each sets its own
// background and its own coin: Android picks drawable vs drawable-night by the phone's dark mode,
// not the app's theme, so the base coin would be wrong (Light on a dark phone gave a white coin on
// paper). The base style (the Auto theme) still follows the phone's light/dark setting.
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidColors, withAndroidStyles, withDangerousMod } = require("expo/config-plugins");

const THEMES = {
  Light: { bg: "#FAFAF9", coin: "light" },
  Dark: { bg: "#000000", coin: "dark" },
  Ink: { bg: "#0B1033", coin: "dark" },
};

// The same sizes expo-splash-screen uses for splashscreen_logo: a 288 dp canvas with the image
// imageWidth dp wide in the middle.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** The light and dark coin images and their width, from the expo-splash-screen plugin's options. */
function splashImages(config) {
  const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === "expo-splash-screen");
  const options = entry?.[1] ?? {};
  if (!options.image || !options.dark?.image) {
    throw new Error("with-splash-themes: expo-splash-screen needs both image and dark.image");
  }
  return { light: options.image, dark: options.dark.image, width: options.imageWidth ?? 100 };
}

async function writeCoins(projectRoot, images) {
  const { compositeImagesAsync, generateImageAsync, generateImageBackgroundAsync } = require("@expo/image-utils");
  const res = path.join(projectRoot, "android/app/src/main/res");
  const jobs = [];
  for (const coin of ["light", "dark"]) {
    for (const [density, multiplier] of Object.entries(DENSITIES)) {
      jobs.push(
        (async () => {
          const size = images.width * multiplier;
          const canvas = 288 * multiplier;
          const background = await generateImageBackgroundAsync({
            width: canvas,
            height: canvas,
            backgroundColor: "transparent",
            resizeMode: "cover",
          });
          const { source: foreground } = await generateImageAsync(
            { projectRoot, cacheType: "finlyt-splash-coins" },
            { src: images[coin], resizeMode: "contain", width: size, height: size },
          );
          const png = await compositeImagesAsync({
            background,
            foreground,
            x: (canvas - size) / 2,
            y: (canvas - size) / 2,
          });
          const dir = path.join(res, `drawable-${density}`);
          await fs.promises.mkdir(dir, { recursive: true });
          await fs.promises.writeFile(path.join(dir, `splashscreen_logo_${coin}.png`), png);
        })(),
      );
    }
  }
  await Promise.all(jobs);
}

module.exports = function withSplashThemes(config) {
  const images = splashImages(config);
  config = withAndroidColors(config, (c) => {
    for (const [name, { bg }] of Object.entries(THEMES)) {
      c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: `splash_${name.toLowerCase()}`, value: bg });
    }
    return c;
  });
  config = withAndroidStyles(config, (c) => {
    for (const [name, { coin }] of Object.entries(THEMES)) {
      const parent = { name: `Theme.App.SplashScreen.${name}`, parent: "Theme.App.SplashScreen" };
      c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
        add: true,
        parent,
        name: "windowSplashScreenBackground",
        value: `@color/splash_${name.toLowerCase()}`,
      });
      c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
        add: true,
        parent,
        name: "windowSplashScreenAnimatedIcon",
        value: `@drawable/splashscreen_logo_${coin}`,
      });
    }
    return c;
  });
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      await writeCoins(c.modRequest.projectRoot, images);
      return c;
    },
  ]);
  return config;
};
