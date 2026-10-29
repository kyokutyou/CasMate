pluginManagement {
    resolutionStrategy.eachPlugin {
        if (requested.id.id == "com.android.library") {
            useModule("com.android.tools.build:gradle:${requested.version ?: "9.3.0"}")
        }
    }
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io") { content { includeGroup("com.github.pedroSG94.RootEncoder") } }
    }
}

rootProject.name = "CasMateAndroid"
include(":app")
listOf("common", "srt", "encoder", "library").forEach { name ->
    include(":rootencoder-$name")
    project(":rootencoder-$name").projectDir = file("vendor/rootencoder/$name")
}
