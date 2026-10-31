package com.heyanle.priestess.bot.platform.adapters.weixin

internal object WeixinMessageChunker {

    fun split(text: String, maxCodePoints: Int): List<String> {
        require(maxCodePoints > 0) { "maxCodePoints must be positive" }
        if (text.isEmpty()) return emptyList()
        if (text.codePointCount(0, text.length) <= maxCodePoints) return listOf(text)

        val chunks = mutableListOf<String>()
        var start = 0
        while (start < text.length) {
            val remaining = text.codePointCount(start, text.length)
            if (remaining <= maxCodePoints) {
                chunks += text.substring(start)
                break
            }

            val hardEnd = text.offsetByCodePoints(start, maxCodePoints)
            val preferredEnd = preferredBoundary(text, start, hardEnd)
            val end = if (preferredEnd > start) preferredEnd else hardEnd
            chunks += text.substring(start, end)
            start = end
        }
        return chunks
    }

    private fun preferredBoundary(text: String, start: Int, hardEnd: Int): Int {
        val minimumUsefulEnd = text.offsetByCodePoints(start, ((text.codePointCount(start, hardEnd) * 3) / 5).coerceAtLeast(1))
        val paragraph = text.lastIndexOf("\n\n", hardEnd - 1)
        if (paragraph >= minimumUsefulEnd) return paragraph + 2
        val newline = text.lastIndexOf('\n', hardEnd - 1)
        if (newline >= minimumUsefulEnd) return newline + 1
        return -1
    }
}
