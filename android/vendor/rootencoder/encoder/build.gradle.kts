// CasMate build integration; upstream source pinned in ../UPSTREAM.md.
plugins { id("com.android.library") }

android {
    namespace = "com.pedro.encoder"
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
    api("androidx.annotation:annotation:1.10.0")
}
