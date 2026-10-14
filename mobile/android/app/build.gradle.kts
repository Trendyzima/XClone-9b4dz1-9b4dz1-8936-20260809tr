plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseStorePath = System.getenv("TESTAGRAM_ANDROID_KEYSTORE_PATH")
val releaseStorePassword = System.getenv("TESTAGRAM_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("TESTAGRAM_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("TESTAGRAM_ANDROID_KEY_PASSWORD")
val hasProductionSigning = listOf(
    releaseStorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "com.xclone.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.xclone.app"
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Keep the production app and F-Droid candidate as explicit variants. Both retain
    // the established application ID; do not install them side-by-side on one device.
    flavorDimensions += "distribution"
    productFlavors {
        create("production") {
            dimension = "distribution"
        }
        create("fdroid") {
            dimension = "distribution"
        }
    }

    signingConfigs {
        if (hasProductionSigning) {
            create("production") {
                storeFile = file(releaseStorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Never silently fall back to the debug key. The production release workflow
            // fails closed unless the durable production signing secrets exist. The
            // fdroid variant is intentionally built unsigned for F-Droid to sign itself.
            if (hasProductionSigning) {
                signingConfig = signingConfigs.getByName("production")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
