package com.heyanle.priestess.bot.config.model

import kotlinx.serialization.Serializable

/** Operator-facing Agent selection; internal prompt presets remain an implementation detail. */
@Serializable
enum class AgentType { NORMAL, DEEPSEEK_HARNESS, CODEX }

enum class AgentEngine { INTERNAL, CODEX }

/** The route-level vocabulary is introduced before route configuration so type capabilities stay explicit. */
@Serializable
enum class ToolInjectionMode { NONE, SINGLE, MULTI, SKILL }
