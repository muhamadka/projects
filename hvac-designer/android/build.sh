#!/usr/bin/env bash
# בניית APK לאנדרואיד ללא Android Studio / Gradle.
# דרישות (אובונטו/דביאן):
#   sudo apt-get install -y aapt dalvik-exchange zipalign apksigner android-sdk-platform-23 openjdk-17-jdk python3-pil
# פלט: dist/hvac-designer.apk
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
B=build
rm -rf "$B" && mkdir -p "$B"/{gen,classes,assets,res,apk} dist

# 1. משאבים: אייקונים + ערכים
cp -r res/. "$B/res/"
python3 make_icon.py "$B/res"

# 2. נכסים: אותו ממשק כמו בגרסת הדפדפן, עטוף במסמך HTML מלא
{
  echo '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  echo '<style>[hidden]{display:none!important}</style></head><body>'
  cat ../index.html
  echo '</body></html>'
} > "$B/assets/index.html"
cp ../hvac-engine.js "$B/assets/"

# 3. R.java + חבילת משאבים
aapt package -f -m -J "$B/gen" -M AndroidManifest.xml -S "$B/res" -A "$B/assets" \
  -I "$ANDROID_JAR" -F "$B/apk/unsigned.apk"

# 4. קומפילציה ל-Java 8 bytecode ו-DEX
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR" \
  -d "$B/classes" $(find src "$B/gen" -name '*.java')
dalvik-exchange --dex --output="$B/apk/classes.dex" "$B/classes"
(cd "$B/apk" && zip -q unsigned.apk classes.dex)

# 5. יישור וחתימה
KS=keystore/release.jks
if [ ! -f "$KS" ]; then
  mkdir -p keystore
  keytool -genkeypair -keystore "$KS" -alias hvac -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass hvacdesigner -keypass hvacdesigner -dname "CN=HVAC Designer, C=IL" >/dev/null 2>&1
fi
zipalign -f 4 "$B/apk/unsigned.apk" "$B/apk/aligned.apk"
apksigner sign --ks "$KS" --ks-pass pass:hvacdesigner --key-pass pass:hvacdesigner \
  --out dist/hvac-designer.apk "$B/apk/aligned.apk"
apksigner verify dist/hvac-designer.apk
echo "✓ dist/hvac-designer.apk ($(du -h dist/hvac-designer.apk | cut -f1))"
