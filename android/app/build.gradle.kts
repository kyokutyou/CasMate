plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "jp.casmate.app"
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    externalNativeBuild {
        cmake { path = file("../../native/outdoor/CMakeLists.txt"); version = "3.22.1" }
    }

    defaultConfig {
        applicationId = "jp.casmate.app"
        minSdk = 29
        targetSdk = 37
        versionCode = 2
        versionName = "0.5.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Robolectric creates its download lock below user.home. Some Windows/JDK
            // installations expose C:\\ as user.home, which is not writable.
            val robolectricHome = rootProject.layout.buildDirectory.dir("robolectric-home").get().asFile
                .apply { mkdirs() }
            it.systemProperty(
                "user.home",
                robolectricHome.absolutePath,
            )
        }
    }
    sourceSets.getByName("test").resources.directories.add("../../tests/fixtures")
}

val checkCompatibility by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "tools/compatibility-policy.mjs", "--check")
}

val prepareOutdoorNative by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "tools/prepare-outdoor-native.mjs")
}
val outdoorNoticeDirectory = objects.directoryProperty().convention(layout.buildDirectory.dir("generated/outdoorAssets"))
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(prepareOutdoorNative) { outdoorNoticeDirectory }
}
tasks.configureEach {
    if (name == "preBuild") dependsOn(checkCompatibility)
    if (name == "preBuild" || name.startsWith("configureCMake")) dependsOn(prepareOutdoorNative)
}

dependencies {
    implementation(project(":rootencoder-library"))
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    testImplementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-service:2.11.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("androidx.webkit:webkit:1.17.0")

    implementation("androidx.camera:camera-core:1.6.2")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("com.google.zxing:core:3.5.4")

    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("androidx.media3:media3-exoplayer:1.11.0")
    implementation("androidx.media3:media3-session:1.11.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.json:json:20260814")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
