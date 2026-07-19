# Sense

## 验证流程

Android 应用需要打包成 release APK 安装到真机上验证，不能依赖 Expo Go 或 dev client。

```bash
# 1. 打包
cd android && ./gradlew assembleRelease

# 2. 检查设备
adb devices

# 3. 安装到手机
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
