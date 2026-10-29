// CasMate build integration; upstream source pinned in ../UPSTREAM.md.
plugins { id("com.android.library") }

android {
    namespace = "com.pedro.library"
    compileSdk = 37
    defaultConfig { minSdk = 29 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")
    api(project(":rootencoder-common"))
    api(project(":rootencoder-encoder"))
    api(project(":rootencoder-srt"))
    // Preserve the other upstream transports without bringing a second copy of
    // the four local modules into the runtime classpath.
    listOf("rtmp", "rtsp", "udp", "whip").forEach { transport ->
        api("com.github.pedroSG94.RootEncoder:$transport:2.8.1") {
            listOf("common", "srt", "encoder", "library").forEach { local ->
                exclude(group = "com.github.pedroSG94.RootEncoder", module = local)
            }
        }
    }
}
