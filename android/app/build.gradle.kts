plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.room)
}

// Release signing comes from environment variables so the keystore and passwords never live in the repo.
// CI decodes the keystore from a secret; locally, export the same variables before `assembleRelease`.
val releaseKeystore = System.getenv("TMS_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }

android {
    namespace = "com.teasoo.tms"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.teasoo.tms.field"
        minSdk = 26
        targetSdk = 35
        // CI passes -PtmsVersionCode (must increase with every release) and -PtmsVersionName.
        versionCode = (project.findProperty("tmsVersionCode") as String?)?.toInt() ?: 1
        versionName = project.findProperty("tmsVersionName") as String? ?: "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Overridable per build: -PtmsApiBaseUrl=https://api.example.org/ -PtmsMapStyleUrl=https://...
        buildConfigField("String", "API_BASE_URL", "\"${project.findProperty("tmsApiBaseUrl") ?: "http://10.0.2.2:3000/"}\"")
        buildConfigField("String", "MAP_STYLE_URL", "\"${project.findProperty("tmsMapStyleUrl") ?: ""}\"")
        // Web portal address, linked from the administrator screens for configuration work.
        buildConfigField("String", "PORTAL_URL", "\"${project.findProperty("tmsPortalUrl") ?: ""}\"")
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("TMS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TMS_KEY_ALIAS")
                keyPassword = System.getenv("TMS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // Without a keystore the release build is produced unsigned (it cannot be installed).
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    sourceSets {
        // Shared tree-ID vectors keep this implementation in step with the backend.
        getByName("test").resources.srcDir("../../spec")
        // Exported Room schemas for migration tests (Robolectric reads the debug variant's assets; not in release builds).
        getByName("debug").assets.srcDir("$projectDir/schemas")
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

room { schemaDirectory("$projectDir/schemas") }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.androidx.compiler)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)

    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.maplibre)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.room.testing)
    testImplementation(libs.work.testing)
    testImplementation(libs.okhttp.mockwebserver)
}
