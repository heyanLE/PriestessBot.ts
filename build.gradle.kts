plugins {
    kotlin("jvm") version "2.3.20"
    kotlin("plugin.serialization") version "2.3.20"
    application
}

group = "com.heyanle.priestess.bot"
version = "1.0-SNAPSHOT"

application {
    mainClass.set("com.heyanle.priestess.bot.PriestessBotKt")
}

tasks.named<JavaExec>("run") {
    doFirst {
        val hasConfigArgument = args.orEmpty().any { it == "--config" || it.startsWith("--config=") }
        if (!hasConfigArgument) {
            args("--config", providers.gradleProperty("configPath").getOrElse("config.json"))
        }
    }
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-client-mock:3.0.3")
    testImplementation("io.ktor:ktor-server-test-host:3.0.3")
    implementation("io.insert-koin:koin-core:4.0.2")
    implementation("io.github.oshai:kotlin-logging-jvm:7.0.13")
    implementation("ch.qos.logback:logback-classic:1.5.18")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.exposed:exposed-core:0.51.1")
    implementation("org.jetbrains.exposed:exposed-dao:0.51.1")
    implementation("org.jetbrains.exposed:exposed-jdbc:0.51.1")
    implementation("org.xerial:sqlite-jdbc:3.46.1.3")
    implementation("org.snakeyaml:snakeyaml-engine:2.7")
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.24.0")
    implementation("io.ktor:ktor-client-core:3.0.3")
    implementation("io.ktor:ktor-client-cio:3.0.3")
    implementation("io.ktor:ktor-client-content-negotiation:3.0.3")
    implementation("io.ktor:ktor-client-websockets:3.0.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.3")
    implementation("io.ktor:ktor-server-core:3.0.3")
    implementation("io.ktor:ktor-server-netty:3.0.3")
    implementation("io.ktor:ktor-server-content-negotiation:3.0.3")
    implementation("io.ktor:ktor-server-websockets:3.0.3")
    implementation("io.ktor:ktor-server-cors:3.0.3")
    implementation("com.google.zxing:core:3.5.3")
    implementation("io.ktor:ktor-server-status-pages:3.0.3")
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        showStandardStreams = true
        events("passed", "skipped", "failed", "standardOut", "standardError")
    }
}

val dashboardDir = layout.projectDirectory.dir("dashboard")
val dashboardDistDir = dashboardDir.dir("dist")
val buildDashboard = providers.gradleProperty("buildDashboard").map(String::toBoolean).orElse(false)

val npmCommand = if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm"

val npmInstallDashboard by tasks.registering(Exec::class) {
    onlyIf { buildDashboard.get() }
    workingDir = dashboardDir.asFile
    commandLine(npmCommand, "install")
    inputs.file(dashboardDir.file("package.json"))
    outputs.dir(dashboardDir.dir("node_modules"))
}

val npmBuildDashboard by tasks.registering(Exec::class) {
    onlyIf { buildDashboard.get() }
    dependsOn(npmInstallDashboard)
    workingDir = dashboardDir.asFile
    commandLine(npmCommand, "run", "build")
    inputs.dir(dashboardDir.dir("src"))
    inputs.file(dashboardDir.file("index.html"))
    inputs.file(dashboardDir.file("package.json"))
    inputs.file(dashboardDir.file("tsconfig.json"))
    inputs.file(dashboardDir.file("vite.config.ts"))
    outputs.dir(dashboardDistDir)
}

tasks.processResources {
    if (buildDashboard.get()) {
        dependsOn(npmBuildDashboard)
        from(dashboardDistDir) {
            into("dashboard")
        }
    }
}
