package com.heyanle.priestess.bot.pipeline

import kotlinx.coroutines.flow.Flow

/**
 * A single step in the message pipeline.
 *
 * Returning `null` means the stage is linear and the controller can continue to
 * the next stage immediately. Returning a [Flow] means the stage uses the onion
 * model: pre-work has already run in [process], the controller runs downstream
 * stages, then collects the returned flow for post-work.
 */
interface Stage {
    val name: String
    val order: StageOrder

    suspend fun process(ctx: PipelineContext): Flow<Unit>?
}

/**
 * Execution order for the pipeline stages.
 */
enum class StageOrder(val level: Int) {
    IM_ROUTE(0),
    WAKING_CHECK(1),
    WHITELIST_CHECK(2),
    RATE_LIMIT(3),
    PREPARE_WORKSPACE(4),
    RESOLVE_PERMISSION(5),
    COMMAND(6),
    PRE_PROCESS(7),
    PROCESS(8),
    RESULT_DECORATE(9),
    RESPOND(10);
}
