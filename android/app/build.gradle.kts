plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ver = (findProperty("appVersion") as String?) ?: "1.0.0"
val code = ((findProperty("appVersionCode") as String?) ?: "1").toInt()

android {
    namespace = "app.omnitill"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.omnitill"
        minSdk = 26
        targetSdk = 34
        versionCode = code
        versionName = ver
    }

    // Release signing comes from environment variables set by the GitHub workflow.
    // Without them (a fork, a local build) the APK is signed with the debug key so it still installs.
    val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
    signingConfigs {
        if (ksPath != null && file(ksPath).exists()) {
            create("release") {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    // The website lives in ../../app and is bundled into the APK, so the app opens instantly and offline.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/www"))
}

val copyWeb by tasks.registering(Copy::class) {
    from("../../app") { exclude("sw.js", "config.local.js") }
    into(layout.buildDirectory.dir("generated/www/www"))
}
tasks.matching {
    (it.name.startsWith("merge") && it.name.endsWith("Assets")) || it.name.contains("Lint", ignoreCase = true)
}.configureEach { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
