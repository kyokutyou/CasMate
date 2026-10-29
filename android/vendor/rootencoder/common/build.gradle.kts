// CasMate build integration; upstream source pinned in ../UPSTREAM.md.
plugins { id("com.android.library") }

android {
    namespace = "com.pedro.common"
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
    implementation("io.ktor:ktor-network:3.5.2")
    implementation("io.ktor:ktor-network-tls:3.5.2")
    implementation("androidx.annotation:annotation:1.10.0")
}
