package com.heyanle.priestess.bot.agent.context

import com.heyanle.priestess.bot.provider.model.ConversationMessage

/** User turns are atomic: their assistant/tool messages cannot survive without their user input. */
internal object ConversationRounds {
    fun split(messages: List<ConversationMessage>): List<List<ConversationMessage>> {
        val rounds = mutableListOf<MutableList<ConversationMessage>>()
        for (message in messages) {
            if (message.role == "system") continue
            if (message.role == "user") rounds += mutableListOf<ConversationMessage>()
            rounds.lastOrNull()?.add(message)
        }
        return rounds
    }
}
