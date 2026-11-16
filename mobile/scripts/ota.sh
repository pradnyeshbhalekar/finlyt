#!/usr/bin/env bash
# Ship a JavaScript-only change to phones over the air (EAS Update). Native changes (a new module,
# a permission, app.json plugins) still need an APK, with the app version bumped.
#
#   npm run ota -- "Fix the goal sheet"            # to phones (channel "production")
#   CHANNEL=preview npm run ota -- "Try something"  # a channel no installed phone listens to
#
# It bundles the app itself, with mobile/.env, and refuses to publish a bundle without the
# server address: an update without it couldn't sign in or load anything.
set -euo pipefail
cd "$(dirname "$0")/.."
message="${1:?Say what changed, like: npm run ota -- \"Fix the goal sheet\"}"
channel="${CHANNEL:-production}"

rm -rf dist
npx expo export --platform android --output-dir dist
bundle=$(ls dist/_expo/static/js/android/*.hbc)
api_url=$(grep '^EXPO_PUBLIC_API_URL=' .env | cut -d= -f2- || true)
# (Not "strings | grep -q": with pipefail, grep stopping early fails the pipe.)
if [ -z "$api_url" ] || ! grep -qF "$api_url" <(strings "$bundle"); then
  echo "Not publishing: the bundle doesn't contain EXPO_PUBLIC_API_URL from mobile/.env." >&2
  exit 1
fi

npx --yes eas-cli@latest update \
  --channel "$channel" --platform android --environment production \
  --skip-bundler --input-dir dist \
  --message "$message" --non-interactive
