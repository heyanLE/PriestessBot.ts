package com.heyanle.priestess.bot.observability.trace

import com.heyanle.priestess.bot.core.db.DatabaseCase
import com.heyanle.priestess.bot.provider.model.TokenUsage
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.SqlExpressionBuilder.eq
import org.jetbrains.exposed.sql.SqlExpressionBuilder.inList
import java.util.UUID

internal object ExecutionsTable : Table("execution_traces") {
    val id = varchar("id", 64)
    val platform = varchar("platform", 256).index()
    val sessionId = varchar("session_id", 256).index()
    val provider = varchar("provider", 256).index()
    val agent = varchar("agent", 256).index()
    val status = varchar("status", 24).index()
    val startedAt = long("started_at").index()
    val payloadBytes = long("payload_bytes").default(0)
    val summary = text("summary")
    override val primaryKey = PrimaryKey(id)
}

internal object ExecutionEventsTable : Table("execution_trace_events") {
    val executionId = varchar("execution_id", 64).index()
    val seq = integer("seq")
    val event = text("event")
    override val primaryKey = PrimaryKey(executionId, seq)
}

/** Ordered append-only event logs and their summary projection are committed atomically. */
class ExecutionTraceController(
    private val db: DatabaseCase,
    private val redactor: TraceRedactor = TraceRedactor(),
    private val maxEvents: Int = 500,
    private val maxExecutionBytes: Long = 4L * 1024 * 1024,
    private val retainedExecutions: Int = 2_000,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

    init {
        require(maxEvents > 0 && maxExecutionBytes > 0 && retainedExecutions > 0)
        db.execute {
            SchemaUtils.createMissingTablesAndColumns(ExecutionsTable, ExecutionEventsTable)
            val interrupted = ExecutionsTable.selectAll().where { ExecutionsTable.status eq ExecutionStatus.RUNNING.name }
                .map { json.decodeFromString<ExecutionSummary>(it[ExecutionsTable.summary]) }
            interrupted.forEach { current ->
                val finished = now()
                val reason = "Process restarted before execution completed"
                append(current.copy(status = ExecutionStatus.FAILED, finishedAt = finished,
                    durationMillis = (finished - current.startedAt).coerceAtLeast(0), error = reason),
                    TraceCategory.AGENT, "execution.interrupted", buildJsonObject { put("error", reason) }, force = true)
            }
        }
    }

    fun start(input: ExecutionTraceInput): ExecutionTraceRecorder {
        val id = UUID.randomUUID().toString()
        val summary = ExecutionSummary(
            id = id, status = ExecutionStatus.RUNNING,
            platform = redactor.text(input.platform, 256), sessionId = redactor.text(input.sessionId, 256),
            messageId = redactor.text(input.messageId, 256), senderId = redactor.text(input.senderId, 256),
            workspaceId = redactor.text(input.workspaceId, 256), agent = redactor.text(input.agent, 256),
            provider = redactor.text(input.provider, 256), model = redactor.text(input.model, 256),
            inputPreview = redactor.text(input.input, 500), startedAt = now(),
        )
        db.execute {
            prune()
            ExecutionsTable.insert {
                it[ExecutionsTable.id] = id
                it[platform] = summary.platform
                it[sessionId] = summary.sessionId
                it[provider] = summary.provider
                it[agent] = summary.agent
                it[status] = summary.status.name
                it[startedAt] = summary.startedAt
                it[ExecutionsTable.summary] = json.encodeToString(summary)
            }
            append(summary, TraceCategory.IM, "message.received", buildJsonObject { put("input", input.input) })
        }
        return ExecutionTraceRecorder(id, this)
    }

    fun identify(id: String, workspaceId: String, agent: String, provider: String, model: String) = db.execute {
        val current = summary(id) ?: return@execute
        if (current.status != ExecutionStatus.RUNNING) return@execute
        val updated = current.copy(
            workspaceId = redactor.text(workspaceId, 256), agent = redactor.text(agent, 256),
            provider = redactor.text(provider, 256), model = redactor.text(model, 256),
        )
        update(updated)
        append(updated, TraceCategory.AGENT, "agent.selected", buildJsonObject {
            put("workspaceId", workspaceId); put("agent", agent); put("provider", provider); put("model", model)
        })
    }

    fun record(
        id: String,
        category: TraceCategory,
        type: String,
        data: JsonObject = buildJsonObject {},
        step: Int? = null,
        durationMillis: Long? = null,
        usage: TokenUsage? = null,
    ) = db.execute {
        val current = summary(id) ?: return@execute
        if (current.status != ExecutionStatus.RUNNING) return@execute
        val updated = if (usage == null) current else current.copy(
            promptTokens = current.promptTokens + usage.promptTokens.coerceAtLeast(0),
            completionTokens = current.completionTokens + usage.completionTokens.coerceAtLeast(0),
            totalTokens = current.totalTokens + usage.totalTokens.coerceAtLeast(0),
        )
        append(updated, category, type, data, step, durationMillis)
    }

    fun complete(id: String, status: ExecutionStatus, output: String = "", error: String? = null) = db.execute {
        require(status != ExecutionStatus.RUNNING) { "Completion must be terminal" }
        val current = summary(id) ?: return@execute
        if (current.status != ExecutionStatus.RUNNING) return@execute
        val finished = now()
        val completed = current.copy(
            status = status, outputPreview = redactor.text(output, 500),
            error = error?.let { redactor.text(it, 2_000) }, finishedAt = finished,
            durationMillis = (finished - current.startedAt).coerceAtLeast(0),
        )
        append(completed, TraceCategory.AGENT, "execution.finished", buildJsonObject {
            put("status", status.name); put("output", output); put("error", error)
        }, force = true)
    }

    fun list(filter: ExecutionTraceFilter = ExecutionTraceFilter()): ExecutionTracePage = db.execute {
        val limit = filter.limit.coerceIn(1, 100)
        val offset = filter.offset.coerceIn(0, 1_000_000)
        val query = ExecutionsTable.selectAll()
        filter.platform?.takeIf { it.isNotBlank() }?.let { value -> query.andWhere { ExecutionsTable.platform eq value } }
        filter.provider?.takeIf { it.isNotBlank() }?.let { value -> query.andWhere { ExecutionsTable.provider eq value } }
        filter.agent?.takeIf { it.isNotBlank() }?.let { value -> query.andWhere { ExecutionsTable.agent eq value } }
        filter.sessionId?.takeIf { it.isNotBlank() }?.let { value -> query.andWhere { ExecutionsTable.sessionId eq value } }
        filter.status?.let { value -> query.andWhere { ExecutionsTable.status eq value.name } }
        val total = query.count()
        val items = query.orderBy(ExecutionsTable.startedAt to SortOrder.DESC, ExecutionsTable.id to SortOrder.DESC)
            .limit(limit, offset.toLong()).map { json.decodeFromString<ExecutionSummary>(it[ExecutionsTable.summary]) }
        ExecutionTracePage(items, total, limit, offset)
    }

    fun detail(id: String, afterSeq: Int = 0, limit: Int = 100): ExecutionTraceDetail? = db.execute {
        val current = summary(id) ?: return@execute null
        val cursor = afterSeq.coerceAtLeast(0)
        val pageSize = limit.coerceIn(1, 200)
        val rows = ExecutionEventsTable.selectAll().where {
            (ExecutionEventsTable.executionId eq id) and (ExecutionEventsTable.seq greater cursor)
        }.orderBy(ExecutionEventsTable.seq to SortOrder.ASC).limit(pageSize + 1)
            .map { json.decodeFromString<ExecutionTraceEvent>(it[ExecutionEventsTable.event]) }
        val events = rows.take(pageSize)
        ExecutionTraceDetail(current, events, events.lastOrNull()?.seq ?: cursor, rows.size > pageSize)
    }

    private fun summary(id: String): ExecutionSummary? = ExecutionsTable.selectAll()
        .where { ExecutionsTable.id eq id }.singleOrNull()
        ?.let { json.decodeFromString(it[ExecutionsTable.summary]) }

    private fun update(value: ExecutionSummary) {
        ExecutionsTable.update({ ExecutionsTable.id eq value.id }) {
            it[summary] = json.encodeToString(value)
            it[agent] = value.agent
            it[provider] = value.provider
            it[status] = value.status.name
        }
    }

    private fun append(
        current: ExecutionSummary,
        category: TraceCategory,
        type: String,
        data: JsonObject,
        step: Int? = null,
        durationMillis: Long? = null,
        force: Boolean = false,
    ) {
        if (!force && current.eventCount >= maxEvents) {
            update(current.copy(truncated = true))
            return
        }
        val used = ExecutionsTable.selectAll().where { ExecutionsTable.id eq current.id }.single()[ExecutionsTable.payloadBytes]
        val clean = redactor.sanitize(data)
        val overBudget = used + clean.data.toString().toByteArray(Charsets.UTF_8).size > maxExecutionBytes
        val bounded = if (overBudget) buildJsonObject { put("omitted", "Execution payload storage limit reached") } else clean.data
        val event = ExecutionTraceEvent(
            current.id, current.eventCount + 1, category, redactor.text(type, 128), step, now(),
            durationMillis?.coerceAtLeast(0), bounded, clean.truncated || overBudget,
        )
        val encoded = json.encodeToString(event)
        ExecutionEventsTable.insert {
            it[executionId] = current.id
            it[seq] = event.seq
            it[ExecutionEventsTable.event] = encoded
        }
        update(current.copy(eventCount = event.seq, truncated = current.truncated || event.truncated))
        ExecutionsTable.update({ ExecutionsTable.id eq current.id }) {
            it[payloadBytes] = used + encoded.toByteArray(Charsets.UTF_8).size
        }
    }

    private fun prune() {
        val excess = (ExecutionsTable.selectAll().count() - retainedExecutions + 1).coerceAtLeast(0).coerceAtMost(1_000).toInt()
        if (excess == 0) return
        val old = ExecutionsTable.selectAll().where { ExecutionsTable.status neq ExecutionStatus.RUNNING.name }
            .orderBy(ExecutionsTable.startedAt to SortOrder.ASC).limit(excess).map { it[ExecutionsTable.id] }
        if (old.isNotEmpty()) {
            ExecutionEventsTable.deleteWhere { executionId inList old }
            ExecutionsTable.deleteWhere { id inList old }
        }
    }
}
