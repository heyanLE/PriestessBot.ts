package com.heyanle.priestess.bot.pipeline

import com.heyanle.priestess.bot.config.model.ConfigurationTrace

/** Non-secret completion view shared by platform and Dashboard message entry points. */
data class PipelineExecutionResult(
    val status: String,
    val content: String,
    val trace: ConfigurationTrace? = null,
    val selectedAgentId: String? = null,
    val selectedRouteId: String? = null,
    val selectionReason: String? = null,
    val error: String? = null,
)
