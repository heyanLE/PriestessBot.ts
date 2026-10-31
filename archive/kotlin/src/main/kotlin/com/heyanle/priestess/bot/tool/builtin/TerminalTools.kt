package com.heyanle.priestess.bot.tool.builtin

import com.heyanle.priestess.bot.tool.AgentToolContext
import com.heyanle.priestess.bot.tool.FunctionTool
import com.heyanle.priestess.bot.tool.ParameterDef
import com.heyanle.priestess.bot.tool.ToolParameters
import com.heyanle.priestess.bot.tool.ToolResult
import com.heyanle.priestess.bot.tool.ToolRiskLevel
import com.heyanle.priestess.bot.tool.ToolSchema
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class TerminalTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "terminal",
        description = "Run a shell command in the current workspace. Use background=true for long-running commands.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("command", description = "Shell command to execute.", required = true),
                ParameterDef("timeout_ms", type = "integer", description = "Foreground timeout in milliseconds, default 30000."),
                ParameterDef("timeout", type = "integer", description = "Backward-compatible timeout alias in milliseconds."),
                ParameterDef("background", type = "boolean", description = "Run in the background and return a session id."),
                ParameterDef("workdir", description = "Workspace-relative working directory override."),
                ParameterDef("pty", type = "boolean", description = "Accepted for compatibility. PTY mode is not implemented yet."),
            ),
            required = listOf("command"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        defaultEnabled = false,
        auditLog = true,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val workspace = context.workspaceLocationOrNull()
            ?: return ToolResult.error("Current context does not expose a workspace root", "WORKSPACE_REQUIRED")
        val command = args["command"]?.trim().orEmpty()
        if (command.isBlank()) return ToolResult.error("command is required", "VALIDATION_ERROR")
        val workdir = resolveWorkdir(workspace, args["workdir"])
            ?: return ToolResult.error("workdir must stay inside the current workspace", "INVALID_WORKDIR")
        val background = parseBooleanArg(args["background"])
        return runCatching {
            if (background) {
                ToolResult.success(json.encodeToString(TerminalRuntime.spawn(command, workdir)))
            } else {
                val timeoutMillis = args["timeout_ms"]?.toLongOrNull()?.coerceIn(100, 300_000)
                    ?: args["timeout"]?.toLongOrNull()?.coerceIn(100, 300_000)
                    ?: 30_000L
                ToolResult.success(json.encodeToString(runInterruptible(Dispatchers.IO) {
                    TerminalRuntime.runForeground(command, workdir, timeoutMillis)
                }))
            }
        }.onFailure { failure ->
            if (failure is CancellationException) throw failure
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to execute command", "TERMINAL_FAILED")
        }
    }

    private fun resolveWorkdir(workspace: WorkspaceToolLocation, raw: String?): Path? {
        return runCatching {
            val path = workspace.resolvePath(raw)
            if (!Files.exists(path) || !Files.isDirectory(path)) workspace.rootDir else path
        }.getOrNull()
    }
}

class ProcessTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "process",
        description = "Inspect and control background terminal sessions.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("action", description = "One of list, poll, log, wait, kill, write, submit, close.", required = true),
                ParameterDef("session_id", description = "Terminal session id for actions other than list."),
                ParameterDef("timeout_ms", type = "integer", description = "Wait timeout in milliseconds for wait."),
                ParameterDef("data", description = "Data to write to stdin for write."),
                ParameterDef("offset", type = "integer", description = "0-based line offset for log."),
                ParameterDef("limit", type = "integer", description = "Maximum lines to return for log, default 200."),
            ),
            required = listOf("action"),
        ),
        riskLevel = ToolRiskLevel.HIGH_RISK,
        defaultEnabled = false,
        auditLog = true,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val action = args["action"]?.trim().orEmpty()
        return runCatching {
            when (action) {
                "list" -> ToolResult.success(json.encodeToString(TerminalRuntime.list()))
                "poll" -> withSession(args) { ToolResult.success(json.encodeToString(TerminalRuntime.poll(it))) }
                "log" -> withSession(args) {
                    val offset = args["offset"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0
                    val limit = args["limit"]?.toIntOrNull()?.coerceIn(1, 2_000) ?: 200
                    ToolResult.success(json.encodeToString(TerminalRuntime.readLog(it, offset, limit)))
                }
                "wait" -> withSession(args) {
                    val timeout = args["timeout_ms"]?.toLongOrNull()?.coerceIn(100, 600_000) ?: 30_000L
                    ToolResult.success(json.encodeToString(runInterruptible(Dispatchers.IO) {
                        TerminalRuntime.waitFor(it, timeout)
                    }))
                }
                "kill" -> withSession(args) { ToolResult.success(json.encodeToString(TerminalRuntime.kill(it))) }
                "write" -> withSession(args) {
                    ToolResult.success(json.encodeToString(TerminalRuntime.write(it, args["data"].orEmpty())))
                }
                "submit" -> withSession(args) {
                    ToolResult.success(json.encodeToString(TerminalRuntime.write(it, args["data"].orEmpty() + "\n")))
                }
                "close" -> withSession(args) { ToolResult.success(json.encodeToString(TerminalRuntime.closeInput(it))) }
                else -> ToolResult.error("Unknown action '$action'. Use list, poll, log, wait, kill, write, submit, close.", "VALIDATION_ERROR")
            }
        }.onFailure { failure ->
            if (failure is CancellationException) throw failure
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to handle process action", "PROCESS_FAILED")
        }
    }

    private suspend fun withSession(args: Map<String, String>, block: suspend (String) -> ToolResult): ToolResult {
        val sessionId = args["session_id"]?.trim().orEmpty()
        if (sessionId.isBlank()) return ToolResult.error("session_id is required for this action", "VALIDATION_ERROR")
        return block(sessionId)
    }
}

class ReadTerminalTool : FunctionTool() {
    override val schema = ToolSchema(
        name = "read_terminal",
        description = "Read terminal output from the most recent command or a specific background session.",
        parameters = ToolParameters(
            properties = listOf(
                ParameterDef("session_id", description = "Optional background session id. Defaults to the most recent terminal session."),
                ParameterDef("start_line", type = "integer", description = "0-based first line to return, default 0."),
                ParameterDef("count", type = "integer", description = "Maximum lines to return, default 200."),
            ),
        ),
        riskLevel = ToolRiskLevel.SAFE_READ,
        defaultEnabled = false,
        auditLog = false,
    )

    private val json = Json { prettyPrint = true; encodeDefaults = true }

    override suspend fun execute(context: AgentToolContext, args: Map<String, String>): ToolResult {
        val sessionId = args["session_id"]?.trim().takeUnless { it.isNullOrBlank() } ?: TerminalRuntime.lastSessionId()
            ?: return ToolResult.error("No terminal session is available yet", "SESSION_NOT_FOUND")
        val start = args["start_line"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0
        val count = args["count"]?.toIntOrNull()?.coerceIn(1, 2_000) ?: 200
        return runCatching {
            ToolResult.success(json.encodeToString(TerminalRuntime.readLog(sessionId, start, count)))
        }.getOrElse { error ->
            ToolResult.error(error.message ?: "Failed to read terminal output", "READ_TERMINAL_FAILED")
        }
    }
}

private object TerminalRuntime {
    private const val MAX_STORED_LINES = 5_000
    private val sessions = ConcurrentHashMap<String, ManagedTerminalSession>()
    @Volatile
    private var lastSessionId: String? = null

    init {
        Runtime.getRuntime().addShutdownHook(Thread { sessions.keys.forEach { killQuietly(it) } })
    }

    fun spawn(command: String, workdir: Path): TerminalCommandResponse {
        val process = buildProcess(command, workdir).start()
        val session = ManagedTerminalSession(
            id = UUID.randomUUID().toString(),
            command = command,
            workdir = workdir.toString(),
            background = true,
            process = process,
        )
        sessions[session.id] = session
        lastSessionId = session.id
        startCapture(session)
        startWaiter(session)
        return session.toTerminalResponse(background = true)
    }

    fun runForeground(command: String, workdir: Path, timeoutMillis: Long): TerminalCommandResponse {
        val process = buildProcess(command, workdir).start()
        val session = ManagedTerminalSession(
            id = UUID.randomUUID().toString(),
            command = command,
            workdir = workdir.toString(),
            background = false,
            process = process,
        )
        sessions[session.id] = session
        lastSessionId = session.id
        startCapture(session)
        try {
            val completed = process.waitFor(timeoutMillis, TimeUnit.MILLISECONDS)
            if (!completed) {
                session.markTimedOut()
                process.destroy()
                if (!process.waitFor(1, TimeUnit.SECONDS)) {
                    process.destroyForcibly()
                    process.waitFor(1, TimeUnit.SECONDS)
                }
            } else {
                session.markExited(process.exitValue())
            }
            session.awaitCapture(1_000)
            return session.toTerminalResponse(background = false)
        } catch (interrupted: InterruptedException) {
            process.destroyForcibly()
            session.markKilled()
            throw interrupted
        }
    }

    fun list(): ProcessListResponse {
        return ProcessListResponse(
            processes = sessions.values
                .sortedByDescending { it.startedAtMillis }
                .map { it.summary() },
        )
    }

    fun poll(sessionId: String): ProcessSessionSummary {
        return requireSession(sessionId).summary()
    }

    fun readLog(sessionId: String, offset: Int, limit: Int): ProcessLogResponse {
        return requireSession(sessionId).readLog(offset, limit)
    }

    fun waitFor(sessionId: String, timeoutMillis: Long): ProcessSessionSummary {
        val session = requireSession(sessionId)
        val process = session.process ?: return session.summary()
        if (session.isRunning()) {
            process.waitFor(timeoutMillis, TimeUnit.MILLISECONDS)
            if (!session.isRunning()) {
                session.awaitCapture(1_000)
            }
        }
        return session.summary()
    }

    fun kill(sessionId: String): ProcessActionResponse {
        val session = requireSession(sessionId)
        val process = session.process ?: return ProcessActionResponse(success = false, message = "Session '$sessionId' has no live process")
        if (!session.isRunning()) {
            return ProcessActionResponse(success = true, message = "Session '$sessionId' is already finished")
        }
        process.destroy()
        if (process.isAlive) {
            process.destroyForcibly()
        }
        session.markKilled()
        return ProcessActionResponse(success = true, message = "Killed session '$sessionId'")
    }

    fun write(sessionId: String, data: String): ProcessActionResponse {
        val session = requireSession(sessionId)
        val writer = session.stdinWriter ?: return ProcessActionResponse(success = false, message = "Session '$sessionId' does not accept stdin")
        if (!session.isRunning()) return ProcessActionResponse(success = false, message = "Session '$sessionId' is not running")
        writer.write(data)
        writer.flush()
        return ProcessActionResponse(success = true, message = "Wrote ${data.length} bytes to stdin")
    }

    fun closeInput(sessionId: String): ProcessActionResponse {
        val session = requireSession(sessionId)
        session.stdinWriter?.close()
        return ProcessActionResponse(success = true, message = "Closed stdin for session '$sessionId'")
    }

    fun lastSessionId(): String? = lastSessionId

    private fun requireSession(sessionId: String): ManagedTerminalSession {
        return sessions[sessionId] ?: throw IllegalArgumentException("Terminal session '$sessionId' was not found")
    }

    private fun buildProcess(command: String, workdir: Path): ProcessBuilder {
        val commandLine = if (isWindows()) {
            listOf("cmd.exe", "/c", command)
        } else {
            listOf("/bin/sh", "-lc", command)
        }
        return ProcessBuilder(commandLine)
            .directory(workdir.toFile())
            .redirectErrorStream(true)
    }

    private fun isWindows(): Boolean = System.getProperty("os.name").startsWith("Windows", ignoreCase = true)

    private fun startCapture(session: ManagedTerminalSession) {
        session.captureThread = thread(start = true, isDaemon = true, name = "terminal-capture-${session.id.take(8)}") {
            val process = session.process ?: return@thread
            InputStreamReader(process.inputStream, StandardCharsets.UTF_8).use { reader ->
                BufferedReader(reader).useLines { lines ->
                    lines.forEach { line -> session.appendLine(line) }
                }
            }
        }
    }

    private fun startWaiter(session: ManagedTerminalSession) {
        thread(start = true, isDaemon = true, name = "terminal-wait-${session.id.take(8)}") {
            val process = session.process ?: return@thread
            val exitCode = process.waitFor()
            session.markExited(exitCode)
            session.awaitCapture(1_000)
        }
    }

    private fun killQuietly(sessionId: String) {
        runCatching { kill(sessionId) }
    }

    private class ManagedTerminalSession(
        val id: String,
        val command: String,
        val workdir: String,
        val background: Boolean,
        val process: Process?,
    ) {
        private val lock = Any()
        private val lines = ArrayDeque<String>()
        private var droppedLineCount = 0
        private var status: String = "running"
        private var exitCode: Int? = null
        private var endedAtMillis: Long? = null
        var captureThread: Thread? = null
        val stdinWriter: OutputStreamWriter? = process?.outputStream?.let { OutputStreamWriter(it, StandardCharsets.UTF_8) }
        val startedAtMillis: Long = System.currentTimeMillis()

        fun appendLine(line: String) {
            synchronized(lock) {
                if (lines.size >= MAX_STORED_LINES) {
                    lines.removeFirst()
                    droppedLineCount += 1
                }
                lines.addLast(line)
            }
        }

        fun isRunning(): Boolean = synchronized(lock) { status == "running" }

        fun markExited(code: Int) {
            synchronized(lock) {
                if (status == "running") {
                    status = if (code == 0) "exited" else "failed"
                    exitCode = code
                    endedAtMillis = System.currentTimeMillis()
                }
            }
        }

        fun markTimedOut() {
            synchronized(lock) {
                status = "timed_out"
                exitCode = null
                endedAtMillis = System.currentTimeMillis()
            }
        }

        fun markKilled() {
            synchronized(lock) {
                status = "killed"
                exitCode = null
                endedAtMillis = System.currentTimeMillis()
            }
        }

        fun awaitCapture(timeoutMillis: Long) {
            captureThread?.join(timeoutMillis)
        }

        fun summary(): ProcessSessionSummary = synchronized(lock) {
            ProcessSessionSummary(
                sessionId = id,
                command = command,
                workdir = workdir,
                background = background,
                status = status,
                exitCode = exitCode,
                pid = process?.pid(),
                startedAtMillis = startedAtMillis,
                endedAtMillis = endedAtMillis,
                totalLines = droppedLineCount + lines.size,
            )
        }

        fun toTerminalResponse(background: Boolean): TerminalCommandResponse = synchronized(lock) {
            val output = lines.joinToString("\n")
            TerminalCommandResponse(
                sessionId = id,
                command = command,
                workdir = workdir,
                background = background,
                status = status,
                exitCode = exitCode,
                pid = process?.pid(),
                output = output,
            )
        }

        fun readLog(offset: Int, limit: Int): ProcessLogResponse = synchronized(lock) {
            val total = droppedLineCount + lines.size
            val safeOffset = offset.coerceAtLeast(0)
            val localStart = (safeOffset - droppedLineCount).coerceAtLeast(0).coerceAtMost(lines.size)
            val visibleLines = lines.drop(localStart).take(limit)
            val start = if (safeOffset < droppedLineCount) droppedLineCount else safeOffset
            val output = visibleLines.joinToString("\n")
            ProcessLogResponse(
                sessionId = id,
                status = status,
                startLine = start,
                returnedLines = visibleLines.size,
                totalLines = total,
                text = output,
                output = output,
                truncated = start + visibleLines.size < total,
            )
        }
    }
}

@Serializable
data class TerminalCommandResponse(
    val sessionId: String,
    val command: String,
    val workdir: String,
    val background: Boolean,
    val status: String,
    val exitCode: Int? = null,
    val pid: Long? = null,
    val output: String,
)

@Serializable
data class ProcessListResponse(
    val processes: List<ProcessSessionSummary>,
)

@Serializable
data class ProcessSessionSummary(
    val sessionId: String,
    val command: String,
    val workdir: String,
    val background: Boolean,
    val status: String,
    val exitCode: Int? = null,
    val pid: Long? = null,
    val startedAtMillis: Long,
    val endedAtMillis: Long? = null,
    val totalLines: Int,
)

@Serializable
data class ProcessLogResponse(
    val sessionId: String,
    val status: String,
    val startLine: Int,
    val returnedLines: Int,
    val totalLines: Int,
    val text: String,
    val output: String,
    val truncated: Boolean,
)

@Serializable
data class ProcessActionResponse(
    val success: Boolean,
    val message: String,
)
